export { LambdaProvider } from './LambdaProvider';
export type { LambdaFunction, LambdaVersion, LambdaProviderOptions } from './LambdaProvider';

export { EcsProvider } from './EcsProvider';
export type {
  EcsCluster,
  EcsService,
  EcsDeployment,
  EcsTaskDefinition,
  EcsContainer,
  EcsPortMapping,
  EcsProviderOptions,
} from './EcsProvider';

export { SsmProvider } from './SsmProvider';
export type { SsmParameter, SsmProviderOptions } from './SsmProvider';

export { SecretsManagerProvider } from './SecretsManagerProvider';
export type {
  SecretMetadata,
  SecretStructure,
  SecretsManagerProviderOptions,
} from './SecretsManagerProvider';

// Phase 1B - Data & Storage providers
export { EfsProvider } from './EfsProvider';
export type {
  EfsFileSystem,
  EfsMountTarget,
  EfsLifecyclePolicy,
  EfsAccessPoint,
  EfsProviderOptions,
} from './EfsProvider';

export { RdsProvider } from './RdsProvider';
export type {
  RdsInstance,
  RdsCluster,
  RdsParameterGroup,
  RdsSnapshot,
  RdsProviderOptions,
} from './RdsProvider';

export { DocumentDbProvider } from './DocumentDbProvider';
export type {
  DocumentDbCluster,
  DocumentDbInstance,
  DocumentDbParameterGroup,
  DocumentDbSnapshot,
  DocumentDbProviderOptions,
} from './DocumentDbProvider';

export { DynamoDbProvider } from './DynamoDbProvider';
export type {
  DynamoDbTable,
  DynamoDbGsi,
  DynamoDbLsi,
  DynamoDbProviderOptions,
} from './DynamoDbProvider';

export { S3Provider } from './S3Provider';
export type {
  S3Bucket,
  S3LifecycleRule,
  S3ProviderOptions,
} from './S3Provider';

// Phase 1C - API & Registry providers
export { ApiGatewayProvider } from './ApiGatewayProvider';
export type {
  ApiGatewayRestApi,
  ApiGatewayStage,
  ApiGatewayDeployment,
  ApiGatewayResource,
  ApiGatewayHttpApi,
  ApiGatewayHttpStage,
  ApiGatewayHttpRoute,
  ApiGatewayProviderOptions,
} from './ApiGatewayProvider';

export { EcrProvider } from './EcrProvider';
export type {
  EcrRepository,
  EcrImage,
  EcrScanFinding,
  EcrScanSummary,
  EcrLifecyclePolicy,
  EcrProviderOptions,
} from './EcrProvider';
