import { LoggerService } from '@backstage/backend-plugin-api';
import {
  RDSClient,
  DescribeDBInstancesCommand,
  DescribeDBClustersCommand,
  DescribeDBParameterGroupsCommand,
  DescribeDBClusterParameterGroupsCommand,
  DescribeDBSnapshotsCommand,
  DescribeDBClusterSnapshotsCommand,
  DBInstance,
  DBCluster,
  DBParameterGroup,
  DBClusterParameterGroup,
  DBSnapshot,
  DBClusterSnapshot,
} from '@aws-sdk/client-rds';
import { AwsCredentialsProvider } from '../credentials/AwsCredentialsProvider';

export interface RdsInstance {
  dbInstanceIdentifier: string;
  dbInstanceArn: string;
  dbInstanceClass: string;
  engine: string;
  engineVersion: string;
  dbInstanceStatus: string;
  masterUsername?: string;
  allocatedStorage: number;
  availabilityZone?: string;
  multiAZ: boolean;
  endpoint?: {
    address: string;
    port: number;
    hostedZoneId?: string;
  };
  storageType: string;
  storageEncrypted: boolean;
  kmsKeyId?: string;
  publiclyAccessible: boolean;
  autoMinorVersionUpgrade: boolean;
  dbParameterGroupName?: string;
  vpcSecurityGroups: string[];
  dbSubnetGroupName?: string;
  backupRetentionPeriod: number;
  preferredBackupWindow?: string;
  preferredMaintenanceWindow?: string;
  latestRestorableTime?: Date;
  instanceCreateTime?: Date;
  tags?: Record<string, string>;
}

export interface RdsCluster {
  dbClusterIdentifier: string;
  dbClusterArn: string;
  engine: string;
  engineVersion: string;
  engineMode?: string;
  status: string;
  masterUsername?: string;
  allocatedStorage?: number;
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
  serverlessV2ScalingConfiguration?: {
    minCapacity?: number;
    maxCapacity?: number;
  };
  members: Array<{
    dbInstanceIdentifier: string;
    isClusterWriter: boolean;
  }>;
  tags?: Record<string, string>;
}

export interface RdsParameterGroup {
  name: string;
  arn: string;
  family: string;
  description?: string;
}

export interface RdsSnapshot {
  snapshotIdentifier: string;
  snapshotArn: string;
  dbIdentifier: string;
  snapshotType: string;
  status: string;
  snapshotCreateTime?: Date;
  allocatedStorage: number;
  engine: string;
  engineVersion: string;
  encrypted: boolean;
}

export interface RdsProviderOptions {
  credentialsProvider: AwsCredentialsProvider;
  logger: LoggerService;
}

export class RdsProvider {
  private readonly credentialsProvider: AwsCredentialsProvider;
  private readonly logger: LoggerService;

  constructor(options: RdsProviderOptions) {
    this.credentialsProvider = options.credentialsProvider;
    this.logger = options.logger;
  }

  private async getClient(accountName: string): Promise<RDSClient> {
    const account = this.credentialsProvider.getAccount(accountName);
    if (!account) {
      throw new Error(`Unknown AWS account: ${accountName}`);
    }

    return new RDSClient({
      region: account.region,
      credentials: this.credentialsProvider.getCredentialsProvider(accountName),
    });
  }

  async listInstances(accountName: string): Promise<RdsInstance[]> {
    const client = await this.getClient(accountName);
    const instances: RdsInstance[] = [];
    let marker: string | undefined;

    do {
      const command = new DescribeDBInstancesCommand({ Marker: marker });
      const response = await client.send(command);

      for (const instance of response.DBInstances ?? []) {
        instances.push(this.mapInstance(instance));
      }

      marker = response.Marker;
    } while (marker);

    this.logger.debug(`Listed ${instances.length} RDS instances for account ${accountName}`);
    return instances;
  }

  async getInstance(accountName: string, dbInstanceIdentifier: string): Promise<RdsInstance | undefined> {
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

  async listClusters(accountName: string): Promise<RdsCluster[]> {
    const client = await this.getClient(accountName);
    const clusters: RdsCluster[] = [];
    let marker: string | undefined;

    do {
      const command = new DescribeDBClustersCommand({ Marker: marker });
      const response = await client.send(command);

      for (const cluster of response.DBClusters ?? []) {
        clusters.push(this.mapCluster(cluster));
      }

      marker = response.Marker;
    } while (marker);

    this.logger.debug(`Listed ${clusters.length} RDS clusters for account ${accountName}`);
    return clusters;
  }

  async getCluster(accountName: string, dbClusterIdentifier: string): Promise<RdsCluster | undefined> {
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

  async listParameterGroups(accountName: string): Promise<RdsParameterGroup[]> {
    const client = await this.getClient(accountName);
    const groups: RdsParameterGroup[] = [];
    let marker: string | undefined;

    do {
      const command = new DescribeDBParameterGroupsCommand({ Marker: marker });
      const response = await client.send(command);

      for (const group of response.DBParameterGroups ?? []) {
        groups.push(this.mapParameterGroup(group));
      }

      marker = response.Marker;
    } while (marker);

    return groups;
  }

  async listClusterParameterGroups(accountName: string): Promise<RdsParameterGroup[]> {
    const client = await this.getClient(accountName);
    const groups: RdsParameterGroup[] = [];
    let marker: string | undefined;

    do {
      const command = new DescribeDBClusterParameterGroupsCommand({ Marker: marker });
      const response = await client.send(command);

      for (const group of response.DBClusterParameterGroups ?? []) {
        groups.push(this.mapClusterParameterGroup(group));
      }

      marker = response.Marker;
    } while (marker);

    return groups;
  }

  async listSnapshots(accountName: string, dbInstanceIdentifier?: string): Promise<RdsSnapshot[]> {
    const client = await this.getClient(accountName);
    const snapshots: RdsSnapshot[] = [];
    let marker: string | undefined;

    do {
      const command = new DescribeDBSnapshotsCommand({
        DBInstanceIdentifier: dbInstanceIdentifier,
        Marker: marker,
      });
      const response = await client.send(command);

      for (const snapshot of response.DBSnapshots ?? []) {
        snapshots.push(this.mapSnapshot(snapshot));
      }

      marker = response.Marker;
    } while (marker);

    return snapshots;
  }

  async listClusterSnapshots(accountName: string, dbClusterIdentifier?: string): Promise<RdsSnapshot[]> {
    const client = await this.getClient(accountName);
    const snapshots: RdsSnapshot[] = [];
    let marker: string | undefined;

    do {
      const command = new DescribeDBClusterSnapshotsCommand({
        DBClusterIdentifier: dbClusterIdentifier,
        Marker: marker,
      });
      const response = await client.send(command);

      for (const snapshot of response.DBClusterSnapshots ?? []) {
        snapshots.push(this.mapClusterSnapshot(snapshot));
      }

      marker = response.Marker;
    } while (marker);

    return snapshots;
  }

  private mapInstance(instance: DBInstance): RdsInstance {
    const tags: Record<string, string> = {};
    for (const tag of instance.TagList ?? []) {
      if (tag.Key && tag.Value) {
        tags[tag.Key] = tag.Value;
      }
    }

    return {
      dbInstanceIdentifier: instance.DBInstanceIdentifier ?? '',
      dbInstanceArn: instance.DBInstanceArn ?? '',
      dbInstanceClass: instance.DBInstanceClass ?? '',
      engine: instance.Engine ?? '',
      engineVersion: instance.EngineVersion ?? '',
      dbInstanceStatus: instance.DBInstanceStatus ?? '',
      masterUsername: instance.MasterUsername,
      allocatedStorage: instance.AllocatedStorage ?? 0,
      availabilityZone: instance.AvailabilityZone,
      multiAZ: instance.MultiAZ ?? false,
      endpoint: instance.Endpoint
        ? {
            address: instance.Endpoint.Address ?? '',
            port: instance.Endpoint.Port ?? 0,
            hostedZoneId: instance.Endpoint.HostedZoneId,
          }
        : undefined,
      storageType: instance.StorageType ?? 'gp2',
      storageEncrypted: instance.StorageEncrypted ?? false,
      kmsKeyId: instance.KmsKeyId,
      publiclyAccessible: instance.PubliclyAccessible ?? false,
      autoMinorVersionUpgrade: instance.AutoMinorVersionUpgrade ?? false,
      dbParameterGroupName: instance.DBParameterGroups?.[0]?.DBParameterGroupName,
      vpcSecurityGroups: (instance.VpcSecurityGroups ?? [])
        .map(sg => sg.VpcSecurityGroupId)
        .filter((id): id is string => !!id),
      dbSubnetGroupName: instance.DBSubnetGroup?.DBSubnetGroupName,
      backupRetentionPeriod: instance.BackupRetentionPeriod ?? 0,
      preferredBackupWindow: instance.PreferredBackupWindow,
      preferredMaintenanceWindow: instance.PreferredMaintenanceWindow,
      latestRestorableTime: instance.LatestRestorableTime,
      instanceCreateTime: instance.InstanceCreateTime,
      tags: Object.keys(tags).length > 0 ? tags : undefined,
    };
  }

  private mapCluster(cluster: DBCluster): RdsCluster {
    const tags: Record<string, string> = {};
    for (const tag of cluster.TagList ?? []) {
      if (tag.Key && tag.Value) {
        tags[tag.Key] = tag.Value;
      }
    }

    return {
      dbClusterIdentifier: cluster.DBClusterIdentifier ?? '',
      dbClusterArn: cluster.DBClusterArn ?? '',
      engine: cluster.Engine ?? '',
      engineVersion: cluster.EngineVersion ?? '',
      engineMode: cluster.EngineMode,
      status: cluster.Status ?? '',
      masterUsername: cluster.MasterUsername,
      allocatedStorage: cluster.AllocatedStorage,
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
      serverlessV2ScalingConfiguration: cluster.ServerlessV2ScalingConfiguration
        ? {
            minCapacity: cluster.ServerlessV2ScalingConfiguration.MinCapacity,
            maxCapacity: cluster.ServerlessV2ScalingConfiguration.MaxCapacity,
          }
        : undefined,
      members: (cluster.DBClusterMembers ?? []).map(m => ({
        dbInstanceIdentifier: m.DBInstanceIdentifier ?? '',
        isClusterWriter: m.IsClusterWriter ?? false,
      })),
      tags: Object.keys(tags).length > 0 ? tags : undefined,
    };
  }

  private mapParameterGroup(group: DBParameterGroup): RdsParameterGroup {
    return {
      name: group.DBParameterGroupName ?? '',
      arn: group.DBParameterGroupArn ?? '',
      family: group.DBParameterGroupFamily ?? '',
      description: group.Description,
    };
  }

  private mapClusterParameterGroup(group: DBClusterParameterGroup): RdsParameterGroup {
    return {
      name: group.DBClusterParameterGroupName ?? '',
      arn: group.DBClusterParameterGroupArn ?? '',
      family: group.DBParameterGroupFamily ?? '',
      description: group.Description,
    };
  }

  private mapSnapshot(snapshot: DBSnapshot): RdsSnapshot {
    return {
      snapshotIdentifier: snapshot.DBSnapshotIdentifier ?? '',
      snapshotArn: snapshot.DBSnapshotArn ?? '',
      dbIdentifier: snapshot.DBInstanceIdentifier ?? '',
      snapshotType: snapshot.SnapshotType ?? '',
      status: snapshot.Status ?? '',
      snapshotCreateTime: snapshot.SnapshotCreateTime,
      allocatedStorage: snapshot.AllocatedStorage ?? 0,
      engine: snapshot.Engine ?? '',
      engineVersion: snapshot.EngineVersion ?? '',
      encrypted: snapshot.Encrypted ?? false,
    };
  }

  private mapClusterSnapshot(snapshot: DBClusterSnapshot): RdsSnapshot {
    return {
      snapshotIdentifier: snapshot.DBClusterSnapshotIdentifier ?? '',
      snapshotArn: snapshot.DBClusterSnapshotArn ?? '',
      dbIdentifier: snapshot.DBClusterIdentifier ?? '',
      snapshotType: snapshot.SnapshotType ?? '',
      status: snapshot.Status ?? '',
      snapshotCreateTime: snapshot.SnapshotCreateTime,
      allocatedStorage: snapshot.AllocatedStorage ?? 0,
      engine: snapshot.Engine ?? '',
      engineVersion: snapshot.EngineVersion ?? '',
      encrypted: snapshot.StorageEncrypted ?? false,
    };
  }
}
