import { LoggerService } from '@backstage/backend-plugin-api';
import {
  DocDBClient,
  DescribeDBClustersCommand,
  DescribeDBInstancesCommand,
  DescribeDBClusterParameterGroupsCommand,
  DescribeDBClusterSnapshotsCommand,
  DBCluster,
  DBInstance,
  DBClusterParameterGroup,
  DBClusterSnapshot,
} from '@aws-sdk/client-docdb';
import { AwsCredentialsProvider } from '../credentials/AwsCredentialsProvider';

export interface DocumentDbCluster {
  dbClusterIdentifier: string;
  dbClusterArn: string;
  engine: string;
  engineVersion: string;
  status: string;
  masterUsername?: string;
  endpoint?: string;
  readerEndpoint?: string;
  port?: number;
  multiAZ: boolean;
  storageEncrypted: boolean;
  kmsKeyId?: string;
  dbSubnetGroup?: string;
  vpcSecurityGroups: string[];
  backupRetentionPeriod: number;
  preferredBackupWindow?: string;
  preferredMaintenanceWindow?: string;
  latestRestorableTime?: Date;
  clusterCreateTime?: Date;
  deletionProtection: boolean;
  members: Array<{
    dbInstanceIdentifier: string;
    isClusterWriter: boolean;
  }>;
  tags?: Record<string, string>;
}

export interface DocumentDbInstance {
  dbInstanceIdentifier: string;
  dbInstanceArn: string;
  dbInstanceClass: string;
  engine: string;
  engineVersion: string;
  dbInstanceStatus: string;
  dbClusterIdentifier?: string;
  availabilityZone?: string;
  endpoint?: {
    address: string;
    port: number;
    hostedZoneId?: string;
  };
  promotionTier?: number;
  publiclyAccessible: boolean;
  autoMinorVersionUpgrade: boolean;
  instanceCreateTime?: Date;
  tags?: Record<string, string>;
}

export interface DocumentDbParameterGroup {
  name: string;
  arn: string;
  family: string;
  description?: string;
}

export interface DocumentDbSnapshot {
  snapshotIdentifier: string;
  snapshotArn: string;
  dbClusterIdentifier: string;
  snapshotType: string;
  status: string;
  snapshotCreateTime?: Date;
  engine: string;
  engineVersion: string;
  storageEncrypted: boolean;
}

export interface DocumentDbProviderOptions {
  credentialsProvider: AwsCredentialsProvider;
  logger: LoggerService;
}

export class DocumentDbProvider {
  private readonly credentialsProvider: AwsCredentialsProvider;
  private readonly logger: LoggerService;

  constructor(options: DocumentDbProviderOptions) {
    this.credentialsProvider = options.credentialsProvider;
    this.logger = options.logger;
  }

  private async getClient(accountName: string): Promise<DocDBClient> {
    const account = this.credentialsProvider.getAccount(accountName);
    if (!account) {
      throw new Error(`Unknown AWS account: ${accountName}`);
    }

    return new DocDBClient({
      region: account.region,
      credentials: this.credentialsProvider.getCredentialsProvider(accountName),
    });
  }

  async listClusters(accountName: string): Promise<DocumentDbCluster[]> {
    const client = await this.getClient(accountName);
    const clusters: DocumentDbCluster[] = [];
    let marker: string | undefined;

    do {
      const command = new DescribeDBClustersCommand({ Marker: marker });
      const response = await client.send(command);

      for (const cluster of response.DBClusters ?? []) {
        clusters.push(this.mapCluster(cluster));
      }

      marker = response.Marker;
    } while (marker);

    this.logger.debug(`Listed ${clusters.length} DocumentDB clusters for account ${accountName}`);
    return clusters;
  }

  async getCluster(accountName: string, dbClusterIdentifier: string): Promise<DocumentDbCluster | undefined> {
    const client = await this.getClient(accountName);

    try {
      const command = new DescribeDBClustersCommand({
        DBClusterIdentifier: dbClusterIdentifier,
      });
      const response = await client.send(command);

      if (!response.DBClusters || response.DBClusters.length === 0) {
        return undefined;
      }

      return this.mapCluster(response.DBClusters[0]);
    } catch (error: any) {
      if (error.name === 'DBClusterNotFoundFault') {
        return undefined;
      }
      throw error;
    }
  }

  async listInstances(accountName: string): Promise<DocumentDbInstance[]> {
    const client = await this.getClient(accountName);
    const instances: DocumentDbInstance[] = [];
    let marker: string | undefined;

    do {
      const command = new DescribeDBInstancesCommand({ Marker: marker });
      const response = await client.send(command);

      for (const instance of response.DBInstances ?? []) {
        instances.push(this.mapInstance(instance));
      }

      marker = response.Marker;
    } while (marker);

    this.logger.debug(`Listed ${instances.length} DocumentDB instances for account ${accountName}`);
    return instances;
  }

  async getInstance(accountName: string, dbInstanceIdentifier: string): Promise<DocumentDbInstance | undefined> {
    const client = await this.getClient(accountName);

    try {
      const command = new DescribeDBInstancesCommand({
        DBInstanceIdentifier: dbInstanceIdentifier,
      });
      const response = await client.send(command);

      if (!response.DBInstances || response.DBInstances.length === 0) {
        return undefined;
      }

      return this.mapInstance(response.DBInstances[0]);
    } catch (error: any) {
      if (error.name === 'DBInstanceNotFoundFault') {
        return undefined;
      }
      throw error;
    }
  }

  async listParameterGroups(accountName: string): Promise<DocumentDbParameterGroup[]> {
    const client = await this.getClient(accountName);
    const groups: DocumentDbParameterGroup[] = [];
    let marker: string | undefined;

    do {
      const command = new DescribeDBClusterParameterGroupsCommand({ Marker: marker });
      const response = await client.send(command);

      for (const group of response.DBClusterParameterGroups ?? []) {
        groups.push(this.mapParameterGroup(group));
      }

      marker = response.Marker;
    } while (marker);

    return groups;
  }

  async listSnapshots(accountName: string, dbClusterIdentifier?: string): Promise<DocumentDbSnapshot[]> {
    const client = await this.getClient(accountName);
    const snapshots: DocumentDbSnapshot[] = [];
    let marker: string | undefined;

    do {
      const command = new DescribeDBClusterSnapshotsCommand({
        DBClusterIdentifier: dbClusterIdentifier,
        Marker: marker,
      });
      const response = await client.send(command);

      for (const snapshot of response.DBClusterSnapshots ?? []) {
        snapshots.push(this.mapSnapshot(snapshot));
      }

      marker = response.Marker;
    } while (marker);

    return snapshots;
  }

  private mapCluster(cluster: DBCluster): DocumentDbCluster {
    const tags: Record<string, string> = {};
    // DocumentDB uses Tags array
    // @ts-ignore - Tags might not be in type definition
    for (const tag of cluster.Tags ?? []) {
      if (tag.Key && tag.Value) {
        tags[tag.Key] = tag.Value;
      }
    }

    return {
      dbClusterIdentifier: cluster.DBClusterIdentifier ?? '',
      dbClusterArn: cluster.DBClusterArn ?? '',
      engine: cluster.Engine ?? 'docdb',
      engineVersion: cluster.EngineVersion ?? '',
      status: cluster.Status ?? '',
      masterUsername: cluster.MasterUsername,
      endpoint: cluster.Endpoint,
      readerEndpoint: cluster.ReaderEndpoint,
      port: cluster.Port,
      multiAZ: cluster.MultiAZ ?? false,
      storageEncrypted: cluster.StorageEncrypted ?? false,
      kmsKeyId: cluster.KmsKeyId,
      dbSubnetGroup: cluster.DBSubnetGroup,
      vpcSecurityGroups: (cluster.VpcSecurityGroups ?? [])
        .map(sg => sg.VpcSecurityGroupId)
        .filter((id): id is string => !!id),
      backupRetentionPeriod: cluster.BackupRetentionPeriod ?? 0,
      preferredBackupWindow: cluster.PreferredBackupWindow,
      preferredMaintenanceWindow: cluster.PreferredMaintenanceWindow,
      latestRestorableTime: cluster.LatestRestorableTime,
      clusterCreateTime: cluster.ClusterCreateTime,
      deletionProtection: cluster.DeletionProtection ?? false,
      members: (cluster.DBClusterMembers ?? []).map(m => ({
        dbInstanceIdentifier: m.DBInstanceIdentifier ?? '',
        isClusterWriter: m.IsClusterWriter ?? false,
      })),
      tags: Object.keys(tags).length > 0 ? tags : undefined,
    };
  }

  private mapInstance(instance: DBInstance): DocumentDbInstance {
    const tags: Record<string, string> = {};
    // @ts-ignore - Tags might not be in type definition
    for (const tag of instance.Tags ?? []) {
      if (tag.Key && tag.Value) {
        tags[tag.Key] = tag.Value;
      }
    }

    return {
      dbInstanceIdentifier: instance.DBInstanceIdentifier ?? '',
      dbInstanceArn: instance.DBInstanceArn ?? '',
      dbInstanceClass: instance.DBInstanceClass ?? '',
      engine: instance.Engine ?? 'docdb',
      engineVersion: instance.EngineVersion ?? '',
      dbInstanceStatus: instance.DBInstanceStatus ?? '',
      dbClusterIdentifier: instance.DBClusterIdentifier,
      availabilityZone: instance.AvailabilityZone,
      endpoint: instance.Endpoint
        ? {
            address: instance.Endpoint.Address ?? '',
            port: instance.Endpoint.Port ?? 0,
            hostedZoneId: instance.Endpoint.HostedZoneId,
          }
        : undefined,
      promotionTier: instance.PromotionTier,
      publiclyAccessible: instance.PubliclyAccessible ?? false,
      autoMinorVersionUpgrade: instance.AutoMinorVersionUpgrade ?? false,
      instanceCreateTime: instance.InstanceCreateTime,
      tags: Object.keys(tags).length > 0 ? tags : undefined,
    };
  }

  private mapParameterGroup(group: DBClusterParameterGroup): DocumentDbParameterGroup {
    return {
      name: group.DBClusterParameterGroupName ?? '',
      arn: group.DBClusterParameterGroupArn ?? '',
      family: group.DBParameterGroupFamily ?? '',
      description: group.Description,
    };
  }

  private mapSnapshot(snapshot: DBClusterSnapshot): DocumentDbSnapshot {
    return {
      snapshotIdentifier: snapshot.DBClusterSnapshotIdentifier ?? '',
      snapshotArn: snapshot.DBClusterSnapshotArn ?? '',
      dbClusterIdentifier: snapshot.DBClusterIdentifier ?? '',
      snapshotType: snapshot.SnapshotType ?? '',
      status: snapshot.Status ?? '',
      snapshotCreateTime: snapshot.SnapshotCreateTime,
      engine: snapshot.Engine ?? 'docdb',
      engineVersion: snapshot.EngineVersion ?? '',
      storageEncrypted: snapshot.StorageEncrypted ?? false,
    };
  }
}
