import { LoggerService } from '@backstage/backend-plugin-api';
import {
  SSMClient,
  GetParameterCommand,
  GetParametersByPathCommand,
  Parameter,
} from '@aws-sdk/client-ssm';
import { AwsCredentialsProvider } from '../credentials/AwsCredentialsProvider';

export interface SsmParameter {
  name: string;
  type: 'String' | 'StringList' | 'SecureString';
  value: string;
  version: number;
  lastModifiedDate?: Date;
  arn?: string;
  dataType?: string;
}

export interface SsmProviderOptions {
  credentialsProvider: AwsCredentialsProvider;
  logger: LoggerService;
}

export class SsmProvider {
  private readonly credentialsProvider: AwsCredentialsProvider;
  private readonly logger: LoggerService;

  constructor(options: SsmProviderOptions) {
    this.credentialsProvider = options.credentialsProvider;
    this.logger = options.logger;
  }

  private async getClient(accountName: string): Promise<SSMClient> {
    const account = this.credentialsProvider.getAccount(accountName);
    if (!account) {
      throw new Error(`Unknown AWS account: ${accountName}`);
    }

    return new SSMClient({
      region: account.region,
      credentials: this.credentialsProvider.getCredentialsProvider(accountName),
    });
  }

  async getParameter(
    accountName: string,
    name: string,
    withDecryption: boolean = false,
  ): Promise<SsmParameter | undefined> {
    const client = await this.getClient(accountName);

    try {
      const command = new GetParameterCommand({
        Name: name,
        WithDecryption: withDecryption,
      });
      const response = await client.send(command);

      if (!response.Parameter) {
        return undefined;
      }

      return this.mapParameter(response.Parameter, withDecryption);
    } catch (error: any) {
      if (error.name === 'ParameterNotFound') {
        return undefined;
      }
      throw error;
    }
  }

  async getParametersByPath(
    accountName: string,
    path: string,
    recursive: boolean = true,
    withDecryption: boolean = false,
  ): Promise<SsmParameter[]> {
    const client = await this.getClient(accountName);
    const parameters: SsmParameter[] = [];
    let nextToken: string | undefined;

    do {
      const command = new GetParametersByPathCommand({
        Path: path,
        Recursive: recursive,
        WithDecryption: withDecryption,
        NextToken: nextToken,
      });
      const response = await client.send(command);

      for (const param of response.Parameters ?? []) {
        parameters.push(this.mapParameter(param, withDecryption));
      }

      nextToken = response.NextToken;
    } while (nextToken);

    this.logger.debug(`Retrieved ${parameters.length} parameters under path ${path}`);
    return parameters;
  }

  private mapParameter(param: Parameter, withDecryption: boolean): SsmParameter {
    const isSecureString = param.Type === 'SecureString';
    let value = param.Value ?? '';

    if (isSecureString && !withDecryption) {
      value = '********';
    }

    return {
      name: param.Name ?? '',
      type: (param.Type as 'String' | 'StringList' | 'SecureString') ?? 'String',
      value,
      version: param.Version ?? 0,
      lastModifiedDate: param.LastModifiedDate,
      arn: param.ARN,
      dataType: param.DataType,
    };
  }
}
