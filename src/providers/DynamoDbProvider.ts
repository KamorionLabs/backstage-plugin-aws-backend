import { LoggerService } from '@backstage/backend-plugin-api';
import {
  DynamoDBClient,
  ListTablesCommand,
  DescribeTableCommand,
  DescribeContinuousBackupsCommand,
  DescribeTimeToLiveCommand,
  ListTagsOfResourceCommand,
  TableDescription,
  GlobalSecondaryIndexDescription,
  LocalSecondaryIndexDescription,
} from '@aws-sdk/client-dynamodb';
import { AwsCredentialsProvider } from '../credentials/AwsCredentialsProvider';

export interface DynamoDbTable {
  tableName: string;
  tableArn: string;
  tableStatus: string;
  creationDateTime?: Date;
  itemCount: number;
  tableSizeBytes: number;
  billingMode: string;
  provisionedThroughput?: {
    readCapacityUnits: number;
    writeCapacityUnits: number;
  };
  keySchema: Array<{
    attributeName: string;
    keyType: string;
  }>;
  attributeDefinitions: Array<{
    attributeName: string;
    attributeType: string;
  }>;
  globalSecondaryIndexes: DynamoDbGsi[];
  localSecondaryIndexes: DynamoDbLsi[];
  streamEnabled: boolean;
  streamViewType?: string;
  ttlEnabled: boolean;
  ttlAttributeName?: string;
  pitrEnabled: boolean;
  latestRestorableDateTime?: Date;
  deletionProtectionEnabled: boolean;
  tableClass?: string;
  tags?: Record<string, string>;
}

export interface DynamoDbGsi {
  indexName: string;
  indexArn?: string;
  indexStatus?: string;
  keySchema: Array<{
    attributeName: string;
    keyType: string;
  }>;
  projection: {
    projectionType: string;
    nonKeyAttributes?: string[];
  };
  itemCount: number;
  indexSizeBytes: number;
  provisionedThroughput?: {
    readCapacityUnits: number;
    writeCapacityUnits: number;
  };
}

export interface DynamoDbLsi {
  indexName: string;
  indexArn?: string;
  keySchema: Array<{
    attributeName: string;
    keyType: string;
  }>;
  projection: {
    projectionType: string;
    nonKeyAttributes?: string[];
  };
  itemCount: number;
  indexSizeBytes: number;
}

export interface DynamoDbProviderOptions {
  credentialsProvider: AwsCredentialsProvider;
  logger: LoggerService;
}

export class DynamoDbProvider {
  private readonly credentialsProvider: AwsCredentialsProvider;
  private readonly logger: LoggerService;

  constructor(options: DynamoDbProviderOptions) {
    this.credentialsProvider = options.credentialsProvider;
    this.logger = options.logger;
  }

  private async getClient(accountName: string): Promise<DynamoDBClient> {
    const account = this.credentialsProvider.getAccount(accountName);
    if (!account) {
      throw new Error(`Unknown AWS account: ${accountName}`);
    }

    return new DynamoDBClient({
      region: account.region,
      credentials: this.credentialsProvider.getCredentialsProvider(accountName),
    });
  }

  async listTables(accountName: string): Promise<string[]> {
    const client = await this.getClient(accountName);
    const tableNames: string[] = [];
    let exclusiveStartTableName: string | undefined;

    do {
      const command = new ListTablesCommand({
        ExclusiveStartTableName: exclusiveStartTableName,
      });
      const response = await client.send(command);

      tableNames.push(...(response.TableNames ?? []));
      exclusiveStartTableName = response.LastEvaluatedTableName;
    } while (exclusiveStartTableName);

    this.logger.debug(`Listed ${tableNames.length} DynamoDB tables for account ${accountName}`);
    return tableNames;
  }

  async getTable(accountName: string, tableName: string): Promise<DynamoDbTable | undefined> {
    const client = await this.getClient(accountName);

    try {
      const command = new DescribeTableCommand({ TableName: tableName });
      const response = await client.send(command);

      if (!response.Table) {
        return undefined;
      }

      // Get TTL info
      let ttlEnabled = false;
      let ttlAttributeName: string | undefined;
      try {
        const ttlCommand = new DescribeTimeToLiveCommand({ TableName: tableName });
        const ttlResponse = await client.send(ttlCommand);
        ttlEnabled = ttlResponse.TimeToLiveDescription?.TimeToLiveStatus === 'ENABLED';
        ttlAttributeName = ttlResponse.TimeToLiveDescription?.AttributeName;
      } catch {
        // TTL info not available
      }

      // Get PITR info
      let pitrEnabled = false;
      let latestRestorableDateTime: Date | undefined;
      try {
        const pitrCommand = new DescribeContinuousBackupsCommand({ TableName: tableName });
        const pitrResponse = await client.send(pitrCommand);
        pitrEnabled =
          pitrResponse.ContinuousBackupsDescription?.PointInTimeRecoveryDescription
            ?.PointInTimeRecoveryStatus === 'ENABLED';
        latestRestorableDateTime =
          pitrResponse.ContinuousBackupsDescription?.PointInTimeRecoveryDescription
            ?.LatestRestorableDateTime;
      } catch {
        // PITR info not available
      }

      // Get tags
      let tags: Record<string, string> | undefined;
      try {
        const tagsCommand = new ListTagsOfResourceCommand({
          ResourceArn: response.Table.TableArn,
        });
        const tagsResponse = await client.send(tagsCommand);
        if (tagsResponse.Tags && tagsResponse.Tags.length > 0) {
          tags = {};
          for (const tag of tagsResponse.Tags) {
            if (tag.Key && tag.Value) {
              tags[tag.Key] = tag.Value;
            }
          }
        }
      } catch {
        // Tags not available
      }

      return this.mapTable(response.Table, ttlEnabled, ttlAttributeName, pitrEnabled, latestRestorableDateTime, tags);
    } catch (error: any) {
      if (error.name === 'ResourceNotFoundException') {
        return undefined;
      }
      throw error;
    }
  }

  async listTablesWithDetails(accountName: string): Promise<DynamoDbTable[]> {
    const tableNames = await this.listTables(accountName);
    const tables: DynamoDbTable[] = [];

    // Fetch details in batches to avoid rate limiting
    const batchSize = 5;
    for (let i = 0; i < tableNames.length; i += batchSize) {
      const batch = tableNames.slice(i, i + batchSize);
      const batchResults = await Promise.all(
        batch.map(name => this.getTable(accountName, name)),
      );
      tables.push(...batchResults.filter((t): t is DynamoDbTable => t !== undefined));
    }

    return tables;
  }

  private mapTable(
    table: TableDescription,
    ttlEnabled: boolean,
    ttlAttributeName: string | undefined,
    pitrEnabled: boolean,
    latestRestorableDateTime: Date | undefined,
    tags?: Record<string, string>,
  ): DynamoDbTable {
    return {
      tableName: table.TableName ?? '',
      tableArn: table.TableArn ?? '',
      tableStatus: table.TableStatus ?? '',
      creationDateTime: table.CreationDateTime,
      itemCount: Number(table.ItemCount ?? 0),
      tableSizeBytes: Number(table.TableSizeBytes ?? 0),
      billingMode: table.BillingModeSummary?.BillingMode ?? 'PROVISIONED',
      provisionedThroughput: table.ProvisionedThroughput
        ? {
            readCapacityUnits: Number(table.ProvisionedThroughput.ReadCapacityUnits ?? 0),
            writeCapacityUnits: Number(table.ProvisionedThroughput.WriteCapacityUnits ?? 0),
          }
        : undefined,
      keySchema: (table.KeySchema ?? []).map(ks => ({
        attributeName: ks.AttributeName ?? '',
        keyType: ks.KeyType ?? '',
      })),
      attributeDefinitions: (table.AttributeDefinitions ?? []).map(ad => ({
        attributeName: ad.AttributeName ?? '',
        attributeType: ad.AttributeType ?? '',
      })),
      globalSecondaryIndexes: (table.GlobalSecondaryIndexes ?? []).map(gsi =>
        this.mapGsi(gsi),
      ),
      localSecondaryIndexes: (table.LocalSecondaryIndexes ?? []).map(lsi =>
        this.mapLsi(lsi),
      ),
      streamEnabled: !!table.StreamSpecification?.StreamEnabled,
      streamViewType: table.StreamSpecification?.StreamViewType,
      ttlEnabled,
      ttlAttributeName,
      pitrEnabled,
      latestRestorableDateTime,
      deletionProtectionEnabled: table.DeletionProtectionEnabled ?? false,
      tableClass: table.TableClassSummary?.TableClass,
      tags,
    };
  }

  private mapGsi(gsi: GlobalSecondaryIndexDescription): DynamoDbGsi {
    return {
      indexName: gsi.IndexName ?? '',
      indexArn: gsi.IndexArn,
      indexStatus: gsi.IndexStatus,
      keySchema: (gsi.KeySchema ?? []).map(ks => ({
        attributeName: ks.AttributeName ?? '',
        keyType: ks.KeyType ?? '',
      })),
      projection: {
        projectionType: gsi.Projection?.ProjectionType ?? 'ALL',
        nonKeyAttributes: gsi.Projection?.NonKeyAttributes,
      },
      itemCount: Number(gsi.ItemCount ?? 0),
      indexSizeBytes: Number(gsi.IndexSizeBytes ?? 0),
      provisionedThroughput: gsi.ProvisionedThroughput
        ? {
            readCapacityUnits: Number(gsi.ProvisionedThroughput.ReadCapacityUnits ?? 0),
            writeCapacityUnits: Number(gsi.ProvisionedThroughput.WriteCapacityUnits ?? 0),
          }
        : undefined,
    };
  }

  private mapLsi(lsi: LocalSecondaryIndexDescription): DynamoDbLsi {
    return {
      indexName: lsi.IndexName ?? '',
      indexArn: lsi.IndexArn,
      keySchema: (lsi.KeySchema ?? []).map(ks => ({
        attributeName: ks.AttributeName ?? '',
        keyType: ks.KeyType ?? '',
      })),
      projection: {
        projectionType: lsi.Projection?.ProjectionType ?? 'ALL',
        nonKeyAttributes: lsi.Projection?.NonKeyAttributes,
      },
      itemCount: Number(lsi.ItemCount ?? 0),
      indexSizeBytes: Number(lsi.IndexSizeBytes ?? 0),
    };
  }
}
