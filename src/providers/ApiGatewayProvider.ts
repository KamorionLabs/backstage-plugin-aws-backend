import { LoggerService } from '@backstage/backend-plugin-api';
import {
  APIGatewayClient,
  GetRestApisCommand,
  GetRestApiCommand,
  GetStagesCommand,
  GetDeploymentsCommand,
  GetResourcesCommand,
  RestApi,
  Stage,
  Deployment,
  Resource,
} from '@aws-sdk/client-api-gateway';
import {
  ApiGatewayV2Client,
  GetApisCommand,
  GetApiCommand,
  GetStagesCommand as GetStagesV2Command,
  GetRoutesCommand,
  Api,
  Stage as StageV2,
  Route,
} from '@aws-sdk/client-apigatewayv2';
import { AwsCredentialsProvider } from '../credentials/AwsCredentialsProvider';

export interface ApiGatewayRestApi {
  id: string;
  name: string;
  description?: string;
  createdDate?: Date;
  version?: string;
  endpointConfiguration?: {
    types: string[];
    vpcEndpointIds?: string[];
  };
  policy?: string;
  tags?: Record<string, string>;
}

export interface ApiGatewayStage {
  stageName: string;
  deploymentId?: string;
  description?: string;
  createdDate?: Date;
  lastUpdatedDate?: Date;
  cacheClusterEnabled: boolean;
  cacheClusterSize?: string;
  cacheClusterStatus?: string;
  tracingEnabled: boolean;
  tags?: Record<string, string>;
}

export interface ApiGatewayDeployment {
  id: string;
  description?: string;
  createdDate?: Date;
}

export interface ApiGatewayResource {
  id: string;
  parentId?: string;
  path: string;
  methods: string[];
}

export interface ApiGatewayHttpApi {
  apiId: string;
  name: string;
  description?: string;
  protocolType: string;
  apiEndpoint?: string;
  createdDate?: Date;
  version?: string;
  corsConfiguration?: {
    allowOrigins?: string[];
    allowMethods?: string[];
    allowHeaders?: string[];
    maxAge?: number;
  };
  tags?: Record<string, string>;
}

export interface ApiGatewayHttpStage {
  stageName: string;
  deploymentId?: string;
  description?: string;
  createdDate?: Date;
  lastUpdatedDate?: Date;
  autoDeploy: boolean;
  tags?: Record<string, string>;
}

export interface ApiGatewayHttpRoute {
  routeId: string;
  routeKey: string;
  target?: string;
  authorizationType?: string;
  authorizerId?: string;
}

export interface ApiGatewayProviderOptions {
  credentialsProvider: AwsCredentialsProvider;
  logger: LoggerService;
}

export class ApiGatewayProvider {
  private readonly credentialsProvider: AwsCredentialsProvider;
  private readonly logger: LoggerService;

  constructor(options: ApiGatewayProviderOptions) {
    this.credentialsProvider = options.credentialsProvider;
    this.logger = options.logger;
  }

  private async getV1Client(accountName: string): Promise<APIGatewayClient> {
    const account = this.credentialsProvider.getAccount(accountName);
    if (!account) {
      throw new Error(`Unknown AWS account: ${accountName}`);
    }

    return new APIGatewayClient({
      region: account.region,
      credentials: this.credentialsProvider.getCredentialsProvider(accountName),
    });
  }

  private async getV2Client(accountName: string): Promise<ApiGatewayV2Client> {
    const account = this.credentialsProvider.getAccount(accountName);
    if (!account) {
      throw new Error(`Unknown AWS account: ${accountName}`);
    }

    return new ApiGatewayV2Client({
      region: account.region,
      credentials: this.credentialsProvider.getCredentialsProvider(accountName),
    });
  }

  // REST API (v1)

  async listRestApis(accountName: string): Promise<ApiGatewayRestApi[]> {
    const client = await this.getV1Client(accountName);
    const apis: ApiGatewayRestApi[] = [];
    let position: string | undefined;

    do {
      const command = new GetRestApisCommand({ position });
      const response = await client.send(command);

      for (const api of response.items ?? []) {
        apis.push(this.mapRestApi(api));
      }

      position = response.position;
    } while (position);

    this.logger.debug(`Listed ${apis.length} REST APIs for account ${accountName}`);
    return apis;
  }

  async getRestApi(accountName: string, restApiId: string): Promise<ApiGatewayRestApi | undefined> {
    const client = await this.getV1Client(accountName);

    try {
      const command = new GetRestApiCommand({ restApiId });
      const response = await client.send(command);
      return this.mapRestApi(response);
    } catch (error: any) {
      if (error.name === 'NotFoundException') {
        return undefined;
      }
      throw error;
    }
  }

  async getRestApiStages(accountName: string, restApiId: string): Promise<ApiGatewayStage[]> {
    const client = await this.getV1Client(accountName);

    const command = new GetStagesCommand({ restApiId });
    const response = await client.send(command);

    return (response.item ?? []).map(s => this.mapStage(s));
  }

  async getRestApiDeployments(accountName: string, restApiId: string): Promise<ApiGatewayDeployment[]> {
    const client = await this.getV1Client(accountName);
    const deployments: ApiGatewayDeployment[] = [];
    let position: string | undefined;

    do {
      const command = new GetDeploymentsCommand({ restApiId, position });
      const response = await client.send(command);

      for (const d of response.items ?? []) {
        deployments.push(this.mapDeployment(d));
      }

      position = response.position;
    } while (position);

    return deployments;
  }

  async getRestApiResources(accountName: string, restApiId: string): Promise<ApiGatewayResource[]> {
    const client = await this.getV1Client(accountName);
    const resources: ApiGatewayResource[] = [];
    let position: string | undefined;

    do {
      const command = new GetResourcesCommand({ restApiId, position });
      const response = await client.send(command);

      for (const r of response.items ?? []) {
        resources.push(this.mapResource(r));
      }

      position = response.position;
    } while (position);

    return resources;
  }

  // HTTP API (v2)

  async listHttpApis(accountName: string): Promise<ApiGatewayHttpApi[]> {
    const client = await this.getV2Client(accountName);
    const apis: ApiGatewayHttpApi[] = [];
    let nextToken: string | undefined;

    do {
      const command = new GetApisCommand({ NextToken: nextToken });
      const response = await client.send(command);

      for (const api of response.Items ?? []) {
        apis.push(this.mapHttpApi(api));
      }

      nextToken = response.NextToken;
    } while (nextToken);

    this.logger.debug(`Listed ${apis.length} HTTP APIs for account ${accountName}`);
    return apis;
  }

  async getHttpApi(accountName: string, apiId: string): Promise<ApiGatewayHttpApi | undefined> {
    const client = await this.getV2Client(accountName);

    try {
      const command = new GetApiCommand({ ApiId: apiId });
      const response = await client.send(command);
      return this.mapHttpApi(response as Api);
    } catch (error: any) {
      if (error.name === 'NotFoundException') {
        return undefined;
      }
      throw error;
    }
  }

  async getHttpApiStages(accountName: string, apiId: string): Promise<ApiGatewayHttpStage[]> {
    const client = await this.getV2Client(accountName);
    const stages: ApiGatewayHttpStage[] = [];
    let nextToken: string | undefined;

    do {
      const command = new GetStagesV2Command({ ApiId: apiId, NextToken: nextToken });
      const response = await client.send(command);

      for (const s of response.Items ?? []) {
        stages.push(this.mapHttpStage(s));
      }

      nextToken = response.NextToken;
    } while (nextToken);

    return stages;
  }

  async getHttpApiRoutes(accountName: string, apiId: string): Promise<ApiGatewayHttpRoute[]> {
    const client = await this.getV2Client(accountName);
    const routes: ApiGatewayHttpRoute[] = [];
    let nextToken: string | undefined;

    do {
      const command = new GetRoutesCommand({ ApiId: apiId, NextToken: nextToken });
      const response = await client.send(command);

      for (const r of response.Items ?? []) {
        routes.push(this.mapHttpRoute(r));
      }

      nextToken = response.NextToken;
    } while (nextToken);

    return routes;
  }

  // Mappers

  private mapRestApi(api: RestApi): ApiGatewayRestApi {
    return {
      id: api.id ?? '',
      name: api.name ?? '',
      description: api.description,
      createdDate: api.createdDate,
      version: api.version,
      endpointConfiguration: api.endpointConfiguration
        ? {
            types: (api.endpointConfiguration.types ?? []) as string[],
            vpcEndpointIds: api.endpointConfiguration.vpcEndpointIds,
          }
        : undefined,
      policy: api.policy,
      tags: api.tags,
    };
  }

  private mapStage(stage: Stage): ApiGatewayStage {
    return {
      stageName: stage.stageName ?? '',
      deploymentId: stage.deploymentId,
      description: stage.description,
      createdDate: stage.createdDate,
      lastUpdatedDate: stage.lastUpdatedDate,
      cacheClusterEnabled: stage.cacheClusterEnabled ?? false,
      cacheClusterSize: stage.cacheClusterSize,
      cacheClusterStatus: stage.cacheClusterStatus,
      tracingEnabled: stage.tracingEnabled ?? false,
      tags: stage.tags,
    };
  }

  private mapDeployment(deployment: Deployment): ApiGatewayDeployment {
    return {
      id: deployment.id ?? '',
      description: deployment.description,
      createdDate: deployment.createdDate,
    };
  }

  private mapResource(resource: Resource): ApiGatewayResource {
    return {
      id: resource.id ?? '',
      parentId: resource.parentId,
      path: resource.path ?? '',
      methods: resource.resourceMethods ? Object.keys(resource.resourceMethods) : [],
    };
  }

  private mapHttpApi(api: Api): ApiGatewayHttpApi {
    return {
      apiId: api.ApiId ?? '',
      name: api.Name ?? '',
      description: api.Description,
      protocolType: api.ProtocolType ?? '',
      apiEndpoint: api.ApiEndpoint,
      createdDate: api.CreatedDate,
      version: api.Version,
      corsConfiguration: api.CorsConfiguration
        ? {
            allowOrigins: api.CorsConfiguration.AllowOrigins,
            allowMethods: api.CorsConfiguration.AllowMethods,
            allowHeaders: api.CorsConfiguration.AllowHeaders,
            maxAge: api.CorsConfiguration.MaxAge,
          }
        : undefined,
      tags: api.Tags,
    };
  }

  private mapHttpStage(stage: StageV2): ApiGatewayHttpStage {
    return {
      stageName: stage.StageName ?? '',
      deploymentId: stage.DeploymentId,
      description: stage.Description,
      createdDate: stage.CreatedDate,
      lastUpdatedDate: stage.LastUpdatedDate,
      autoDeploy: stage.AutoDeploy ?? false,
      tags: stage.Tags,
    };
  }

  private mapHttpRoute(route: Route): ApiGatewayHttpRoute {
    return {
      routeId: route.RouteId ?? '',
      routeKey: route.RouteKey ?? '',
      target: route.Target,
      authorizationType: route.AuthorizationType,
      authorizerId: route.AuthorizerId,
    };
  }
}
