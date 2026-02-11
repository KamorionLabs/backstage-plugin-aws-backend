import { LoggerService } from '@backstage/backend-plugin-api';
import {
  SecretsManagerClient,
  ListSecretsCommand,
  DescribeSecretCommand,
  SecretListEntry,
  DescribeSecretResponse,
} from '@aws-sdk/client-secrets-manager';
import { AwsCredentialsProvider } from '../credentials/AwsCredentialsProvider';

export interface SecretMetadata {
  name: string;
  arn: string;
  description?: string;
  kmsKeyId?: string;
  rotationEnabled: boolean;
  lastChangedDate?: Date;
  lastAccessedDate?: Date;
  tags?: Record<string, string>;
}

export interface SecretStructure {
  name: string;
  arn: string;
  keys: string[];
  hasValue: boolean;
}

export interface SecretsManagerProviderOptions {
  credentialsProvider: AwsCredentialsProvider;
  logger: LoggerService;
}

export class SecretsManagerProvider {
  private readonly credentialsProvider: AwsCredentialsProvider;
  private readonly logger: LoggerService;

  constructor(options: SecretsManagerProviderOptions) {
    this.credentialsProvider = options.credentialsProvider;
    this.logger = options.logger;
  }

  private async getClient(accountName: string): Promise<SecretsManagerClient> {
    const account = this.credentialsProvider.getAccount(accountName);
    if (!account) {
      throw new Error(`Unknown AWS account: ${accountName}`);
    }

    return new SecretsManagerClient({
      region: account.region,
      credentials: this.credentialsProvider.getCredentialsProvider(accountName),
    });
  }

  async listSecrets(accountName: string): Promise<SecretMetadata[]> {
    const client = await this.getClient(accountName);
    const secrets: SecretMetadata[] = [];
    let nextToken: string | undefined;

    do {
      const command = new ListSecretsCommand({ NextToken: nextToken });
      const response = await client.send(command);

      for (const secret of response.SecretList ?? []) {
        secrets.push(this.mapSecret(secret));
      }

      nextToken = response.NextToken;
    } while (nextToken);

    this.logger.debug(`Listed ${secrets.length} secrets for account ${accountName}`);
    return secrets;
  }

  async getSecret(accountName: string, secretName: string): Promise<SecretMetadata | undefined> {
    const client = await this.getClient(accountName);

    try {
      const command = new DescribeSecretCommand({ SecretId: secretName });
      const response = await client.send(command);

      return this.mapDescribeSecret(response);
    } catch (error: any) {
      if (error.name === 'ResourceNotFoundException') {
        return undefined;
      }
      throw error;
    }
  }

  async getSecretStructure(
    accountName: string,
    secretName: string,
  ): Promise<SecretStructure | undefined> {
    const secret = await this.getSecret(accountName, secretName);
    if (!secret) {
      return undefined;
    }

    return {
      name: secret.name,
      arn: secret.arn,
      keys: [],
      hasValue: true,
    };
  }

  private mapSecret(secret: SecretListEntry): SecretMetadata {
    const tags: Record<string, string> = {};
    for (const tag of secret.Tags ?? []) {
      if (tag.Key && tag.Value) {
        tags[tag.Key] = tag.Value;
      }
    }

    return {
      name: secret.Name ?? '',
      arn: secret.ARN ?? '',
      description: secret.Description,
      kmsKeyId: secret.KmsKeyId,
      rotationEnabled: secret.RotationEnabled ?? false,
      lastChangedDate: secret.LastChangedDate,
      lastAccessedDate: secret.LastAccessedDate,
      tags: Object.keys(tags).length > 0 ? tags : undefined,
    };
  }

  private mapDescribeSecret(response: DescribeSecretResponse): SecretMetadata {
    const tags: Record<string, string> = {};
    for (const tag of response.Tags ?? []) {
      if (tag.Key && tag.Value) {
        tags[tag.Key] = tag.Value;
      }
    }

    return {
      name: response.Name ?? '',
      arn: response.ARN ?? '',
      description: response.Description,
      kmsKeyId: response.KmsKeyId,
      rotationEnabled: response.RotationEnabled ?? false,
      lastChangedDate: response.LastChangedDate,
      lastAccessedDate: response.LastAccessedDate,
      tags: Object.keys(tags).length > 0 ? tags : undefined,
    };
  }
}
