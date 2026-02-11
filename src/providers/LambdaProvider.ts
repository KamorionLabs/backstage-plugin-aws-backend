import { LoggerService } from '@backstage/backend-plugin-api';
import {
  LambdaClient,
  ListFunctionsCommand,
  GetFunctionCommand,
  ListVersionsByFunctionCommand,
  GetFunctionConfigurationCommand,
  FunctionConfiguration,
} from '@aws-sdk/client-lambda';
import { AwsCredentialsProvider } from '../credentials/AwsCredentialsProvider';

export interface LambdaFunction {
  functionName: string;
  functionArn: string;
  runtime?: string;
  handler?: string;
  codeSize: number;
  description?: string;
  timeout?: number;
  memorySize?: number;
  lastModified?: string;
  version: string;
  environment?: Record<string, string>;
  tags?: Record<string, string>;
}

export interface LambdaVersion {
  version: string;
  description?: string;
  lastModified?: string;
}

export interface LambdaProviderOptions {
  credentialsProvider: AwsCredentialsProvider;
  logger: LoggerService;
}

export class LambdaProvider {
  private readonly credentialsProvider: AwsCredentialsProvider;
  private readonly logger: LoggerService;

  constructor(options: LambdaProviderOptions) {
    this.credentialsProvider = options.credentialsProvider;
    this.logger = options.logger;
  }

  private async getClient(accountName: string): Promise<LambdaClient> {
    const account = this.credentialsProvider.getAccount(accountName);
    if (!account) {
      throw new Error(`Unknown AWS account: ${accountName}`);
    }

    return new LambdaClient({
      region: account.region,
      credentials: this.credentialsProvider.getCredentialsProvider(accountName),
    });
  }

  async listFunctions(accountName: string): Promise<LambdaFunction[]> {
    const client = await this.getClient(accountName);
    const functions: LambdaFunction[] = [];
    let marker: string | undefined;

    do {
      const command = new ListFunctionsCommand({ Marker: marker });
      const response = await client.send(command);

      for (const fn of response.Functions ?? []) {
        functions.push(this.mapFunction(fn));
      }

      marker = response.NextMarker;
    } while (marker);

    this.logger.debug(`Listed ${functions.length} Lambda functions for account ${accountName}`);
    return functions;
  }

  async getFunction(accountName: string, functionName: string): Promise<LambdaFunction | undefined> {
    const client = await this.getClient(accountName);

    try {
      const command = new GetFunctionCommand({ FunctionName: functionName });
      const response = await client.send(command);

      if (!response.Configuration) {
        return undefined;
      }

      return {
        ...this.mapFunction(response.Configuration),
        tags: response.Tags,
      };
    } catch (error: any) {
      if (error.name === 'ResourceNotFoundException') {
        return undefined;
      }
      throw error;
    }
  }

  async listVersions(accountName: string, functionName: string): Promise<LambdaVersion[]> {
    const client = await this.getClient(accountName);
    const versions: LambdaVersion[] = [];
    let marker: string | undefined;

    do {
      const command = new ListVersionsByFunctionCommand({
        FunctionName: functionName,
        Marker: marker,
      });
      const response = await client.send(command);

      for (const v of response.Versions ?? []) {
        versions.push({
          version: v.Version ?? '$LATEST',
          description: v.Description,
          lastModified: v.LastModified,
        });
      }

      marker = response.NextMarker;
    } while (marker);

    return versions;
  }

  async getFunctionConfiguration(
    accountName: string,
    functionName: string,
  ): Promise<LambdaFunction | undefined> {
    const client = await this.getClient(accountName);

    try {
      const command = new GetFunctionConfigurationCommand({ FunctionName: functionName });
      const response = await client.send(command);
      return this.mapFunction(response);
    } catch (error: any) {
      if (error.name === 'ResourceNotFoundException') {
        return undefined;
      }
      throw error;
    }
  }

  private mapFunction(fn: FunctionConfiguration): LambdaFunction {
    return {
      functionName: fn.FunctionName ?? '',
      functionArn: fn.FunctionArn ?? '',
      runtime: fn.Runtime,
      handler: fn.Handler,
      codeSize: fn.CodeSize ?? 0,
      description: fn.Description,
      timeout: fn.Timeout,
      memorySize: fn.MemorySize,
      lastModified: fn.LastModified,
      version: fn.Version ?? '$LATEST',
      environment: fn.Environment?.Variables,
    };
  }
}
