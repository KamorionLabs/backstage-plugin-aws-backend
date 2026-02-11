import { LoggerService } from '@backstage/backend-plugin-api';
import {
  ECSClient,
  ListClustersCommand,
  ListServicesCommand,
  DescribeServicesCommand,
  DescribeTaskDefinitionCommand,
  Service,
  TaskDefinition,
  ContainerDefinition,
} from '@aws-sdk/client-ecs';
import { AwsCredentialsProvider } from '../credentials/AwsCredentialsProvider';

export interface EcsCluster {
  clusterArn: string;
  clusterName: string;
}

export interface EcsService {
  serviceName: string;
  serviceArn: string;
  clusterArn: string;
  status: string;
  desiredCount: number;
  runningCount: number;
  pendingCount: number;
  taskDefinition: string;
  launchType?: string;
  platformVersion?: string;
  deployments?: EcsDeployment[];
}

export interface EcsDeployment {
  id: string;
  status: string;
  taskDefinition: string;
  desiredCount: number;
  runningCount: number;
  pendingCount: number;
  createdAt?: Date;
  updatedAt?: Date;
  rolloutState?: string;
}

export interface EcsTaskDefinition {
  taskDefinitionArn: string;
  family: string;
  revision: number;
  status: string;
  cpu?: string;
  memory?: string;
  networkMode?: string;
  containers: EcsContainer[];
}

export interface EcsContainer {
  name: string;
  image: string;
  cpu?: number;
  memory?: number;
  memoryReservation?: number;
  essential: boolean;
  portMappings?: EcsPortMapping[];
  environment?: Record<string, string>;
}

export interface EcsPortMapping {
  containerPort: number;
  hostPort?: number;
  protocol: string;
}

export interface EcsProviderOptions {
  credentialsProvider: AwsCredentialsProvider;
  logger: LoggerService;
}

export class EcsProvider {
  private readonly credentialsProvider: AwsCredentialsProvider;
  // @ts-ignore - reserved for future use
  private readonly logger: LoggerService;

  constructor(options: EcsProviderOptions) {
    this.credentialsProvider = options.credentialsProvider;
    this.logger = options.logger;
  }

  private async getClient(accountName: string): Promise<ECSClient> {
    const account = this.credentialsProvider.getAccount(accountName);
    if (!account) {
      throw new Error(`Unknown AWS account: ${accountName}`);
    }

    return new ECSClient({
      region: account.region,
      credentials: this.credentialsProvider.getCredentialsProvider(accountName),
    });
  }

  async listClusters(accountName: string): Promise<EcsCluster[]> {
    const client = await this.getClient(accountName);
    const clusters: EcsCluster[] = [];
    let nextToken: string | undefined;

    do {
      const command = new ListClustersCommand({ nextToken });
      const response = await client.send(command);

      for (const arn of response.clusterArns ?? []) {
        const name = arn.split('/').pop() ?? arn;
        clusters.push({ clusterArn: arn, clusterName: name });
      }

      nextToken = response.nextToken;
    } while (nextToken);

    return clusters;
  }

  async listServices(accountName: string, clusterName: string): Promise<string[]> {
    const client = await this.getClient(accountName);
    const services: string[] = [];
    let nextToken: string | undefined;

    do {
      const command = new ListServicesCommand({ cluster: clusterName, nextToken });
      const response = await client.send(command);

      for (const arn of response.serviceArns ?? []) {
        const name = arn.split('/').pop() ?? arn;
        services.push(name);
      }

      nextToken = response.nextToken;
    } while (nextToken);

    return services;
  }

  async getService(
    accountName: string,
    clusterName: string,
    serviceName: string,
  ): Promise<EcsService | undefined> {
    const client = await this.getClient(accountName);

    const command = new DescribeServicesCommand({
      cluster: clusterName,
      services: [serviceName],
    });
    const response = await client.send(command);

    const service = response.services?.[0];
    if (!service) {
      return undefined;
    }

    return this.mapService(service);
  }

  async getTaskDefinition(
    accountName: string,
    taskDefinitionArn: string,
  ): Promise<EcsTaskDefinition | undefined> {
    const client = await this.getClient(accountName);

    try {
      const command = new DescribeTaskDefinitionCommand({
        taskDefinition: taskDefinitionArn,
      });
      const response = await client.send(command);

      if (!response.taskDefinition) {
        return undefined;
      }

      return this.mapTaskDefinition(response.taskDefinition);
    } catch (error: any) {
      if (error.name === 'ClientException') {
        return undefined;
      }
      throw error;
    }
  }

  private mapService(service: Service): EcsService {
    return {
      serviceName: service.serviceName ?? '',
      serviceArn: service.serviceArn ?? '',
      clusterArn: service.clusterArn ?? '',
      status: service.status ?? 'UNKNOWN',
      desiredCount: service.desiredCount ?? 0,
      runningCount: service.runningCount ?? 0,
      pendingCount: service.pendingCount ?? 0,
      taskDefinition: service.taskDefinition ?? '',
      launchType: service.launchType,
      platformVersion: service.platformVersion,
      deployments: service.deployments?.map(d => ({
        id: d.id ?? '',
        status: d.status ?? 'UNKNOWN',
        taskDefinition: d.taskDefinition ?? '',
        desiredCount: d.desiredCount ?? 0,
        runningCount: d.runningCount ?? 0,
        pendingCount: d.pendingCount ?? 0,
        createdAt: d.createdAt,
        updatedAt: d.updatedAt,
        rolloutState: d.rolloutState,
      })),
    };
  }

  private mapTaskDefinition(td: TaskDefinition): EcsTaskDefinition {
    return {
      taskDefinitionArn: td.taskDefinitionArn ?? '',
      family: td.family ?? '',
      revision: td.revision ?? 0,
      status: td.status ?? 'UNKNOWN',
      cpu: td.cpu,
      memory: td.memory,
      networkMode: td.networkMode,
      containers: (td.containerDefinitions ?? []).map(c => this.mapContainer(c)),
    };
  }

  private mapContainer(c: ContainerDefinition): EcsContainer {
    const env: Record<string, string> = {};
    for (const e of c.environment ?? []) {
      if (e.name && e.value) {
        env[e.name] = e.value;
      }
    }

    return {
      name: c.name ?? '',
      image: c.image ?? '',
      cpu: c.cpu,
      memory: c.memory,
      memoryReservation: c.memoryReservation,
      essential: c.essential ?? true,
      portMappings: c.portMappings?.map(p => ({
        containerPort: p.containerPort ?? 0,
        hostPort: p.hostPort,
        protocol: p.protocol ?? 'tcp',
      })),
      environment: Object.keys(env).length > 0 ? env : undefined,
    };
  }
}
