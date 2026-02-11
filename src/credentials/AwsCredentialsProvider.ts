import { Config } from '@backstage/config';
import { LoggerService } from '@backstage/backend-plugin-api';
import { STSClient, AssumeRoleCommand } from '@aws-sdk/client-sts';
import { fromTemporaryCredentials } from '@aws-sdk/credential-providers';
import type { AwsCredentialIdentity } from '@aws-sdk/types';

export interface AwsAccount {
  name: string;
  accountId: string;
  region: string;
  roleArn: string;
  externalId?: string;
}

export interface AwsCredentialsProviderOptions {
  config: Config;
  logger: LoggerService;
}

export class AwsCredentialsProvider {
  private readonly accounts: Map<string, AwsAccount> = new Map();
  private readonly logger: LoggerService;
  private readonly credentialsCache: Map<string, { credentials: AwsCredentialIdentity; expiresAt: number }> = new Map();

  constructor(options: AwsCredentialsProviderOptions) {
    this.logger = options.logger;
    this.loadAccounts(options.config);
  }

  private loadAccounts(config: Config): void {
    const awsConfig = config.getOptionalConfig('aws');
    if (!awsConfig) {
      this.logger.warn('No AWS configuration found in app-config.yaml');
      return;
    }

    const accountsConfig = awsConfig.getOptionalConfigArray('accounts') ?? [];
    for (const accountConfig of accountsConfig) {
      const account: AwsAccount = {
        name: accountConfig.getString('name'),
        accountId: accountConfig.getString('accountId'),
        region: accountConfig.getString('region'),
        roleArn: accountConfig.getString('roleArn'),
        externalId: accountConfig.getOptionalString('externalId'),
      };
      this.accounts.set(account.name, account);
      this.logger.info(`Loaded AWS account: ${account.name} (${account.accountId})`);
    }
  }

  getAccounts(): AwsAccount[] {
    return Array.from(this.accounts.values());
  }

  getAccount(name: string): AwsAccount | undefined {
    return this.accounts.get(name);
  }

  async getCredentials(accountName: string): Promise<AwsCredentialIdentity> {
    const account = this.accounts.get(accountName);
    if (!account) {
      throw new Error(`Unknown AWS account: ${accountName}`);
    }

    const cached = this.credentialsCache.get(accountName);
    if (cached && cached.expiresAt > Date.now() + 60000) {
      return cached.credentials;
    }

    this.logger.debug(`Assuming role for account: ${accountName}`);

    const stsClient = new STSClient({ region: account.region });

    const assumeRoleParams: any = {
      RoleArn: account.roleArn,
      RoleSessionName: `backstage-aws-plugin-${Date.now()}`,
      DurationSeconds: 3600,
    };

    if (account.externalId) {
      assumeRoleParams.ExternalId = account.externalId;
    }

    const command = new AssumeRoleCommand(assumeRoleParams);
    const response = await stsClient.send(command);

    if (!response.Credentials) {
      throw new Error(`Failed to assume role for account: ${accountName}`);
    }

    const credentials: AwsCredentialIdentity = {
      accessKeyId: response.Credentials.AccessKeyId!,
      secretAccessKey: response.Credentials.SecretAccessKey!,
      sessionToken: response.Credentials.SessionToken,
      expiration: response.Credentials.Expiration,
    };

    this.credentialsCache.set(accountName, {
      credentials,
      expiresAt: response.Credentials.Expiration?.getTime() ?? Date.now() + 3600000,
    });

    return credentials;
  }

  getCredentialsProvider(accountName: string) {
    const account = this.accounts.get(accountName);
    if (!account) {
      throw new Error(`Unknown AWS account: ${accountName}`);
    }

    const params: any = {
      params: {
        RoleArn: account.roleArn,
        RoleSessionName: `backstage-aws-plugin-${Date.now()}`,
        DurationSeconds: 3600,
      },
      clientConfig: { region: account.region },
    };

    if (account.externalId) {
      params.params.ExternalId = account.externalId;
    }

    return fromTemporaryCredentials(params);
  }
}
