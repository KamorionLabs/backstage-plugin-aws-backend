export { awsPlugin as default } from './plugin';

export { AwsCredentialsProvider } from './credentials';
export type { AwsAccount, AwsCredentialsProviderOptions } from './credentials';

export {
  LambdaProvider,
  EcsProvider,
  SsmProvider,
  SecretsManagerProvider,
  // Phase 1B providers
  EfsProvider,
  RdsProvider,
  DocumentDbProvider,
  DynamoDbProvider,
  S3Provider,
  // Phase 1C providers
  ApiGatewayProvider,
  EcrProvider,
} from './providers';
export type {
  LambdaFunction,
  LambdaVersion,
  LambdaProviderOptions,
  EcsCluster,
  EcsService,
  EcsDeployment,
  EcsTaskDefinition,
  EcsContainer,
  EcsPortMapping,
  EcsProviderOptions,
  SsmParameter,
  SsmProviderOptions,
  SecretMetadata,
  SecretStructure,
  SecretsManagerProviderOptions,
  // Phase 1B types
  EfsFileSystem,
  EfsMountTarget,
  EfsLifecyclePolicy,
  EfsAccessPoint,
  EfsProviderOptions,
  RdsInstance,
  RdsCluster,
  RdsParameterGroup,
  RdsSnapshot,
  RdsProviderOptions,
  DocumentDbCluster,
  DocumentDbInstance,
  DocumentDbParameterGroup,
  DocumentDbSnapshot,
  DocumentDbProviderOptions,
  DynamoDbTable,
  DynamoDbGsi,
  DynamoDbLsi,
  DynamoDbProviderOptions,
  S3Bucket,
  S3LifecycleRule,
  S3ProviderOptions,
  // Phase 1C types
  ApiGatewayRestApi,
  ApiGatewayStage,
  ApiGatewayDeployment,
  ApiGatewayResource,
  ApiGatewayHttpApi,
  ApiGatewayHttpStage,
  ApiGatewayHttpRoute,
  ApiGatewayProviderOptions,
  EcrRepository,
  EcrImage,
  EcrScanFinding,
  EcrScanSummary,
  EcrLifecyclePolicy,
  EcrProviderOptions,
} from './providers';

export { createRouter } from './service/router';
export type { RouterOptions } from './service/router';
