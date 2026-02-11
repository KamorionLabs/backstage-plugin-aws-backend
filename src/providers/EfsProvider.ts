import { LoggerService } from '@backstage/backend-plugin-api';
import {
  EFSClient,
  DescribeFileSystemsCommand,
  DescribeMountTargetsCommand,
  DescribeLifecycleConfigurationCommand,
  DescribeAccessPointsCommand,
  FileSystemDescription,
  MountTargetDescription,
  LifecyclePolicy,
  AccessPointDescription,
} from '@aws-sdk/client-efs';
import { AwsCredentialsProvider } from '../credentials/AwsCredentialsProvider';

export interface EfsFileSystem {
  fileSystemId: string;
  fileSystemArn: string;
  name?: string;
  creationTime: Date;
  lifeCycleState: string;
  numberOfMountTargets: number;
  sizeInBytes: number;
  performanceMode: string;
  throughputMode: string;
  provisionedThroughputInMibps?: number;
  encrypted: boolean;
  kmsKeyId?: string;
  tags?: Record<string, string>;
}

export interface EfsMountTarget {
  mountTargetId: string;
  fileSystemId: string;
  subnetId: string;
  lifeCycleState: string;
  ipAddress?: string;
  networkInterfaceId?: string;
  availabilityZoneId?: string;
  availabilityZoneName?: string;
  vpcId?: string;
}

export interface EfsLifecyclePolicy {
  transitionToIA?: string;
  transitionToPrimaryStorageClass?: string;
  transitionToArchive?: string;
}

export interface EfsAccessPoint {
  accessPointId: string;
  accessPointArn: string;
  fileSystemId: string;
  name?: string;
  lifeCycleState: string;
  rootDirectory?: {
    path?: string;
    creationInfo?: {
      ownerUid: number;
      ownerGid: number;
      permissions: string;
    };
  };
  posixUser?: {
    uid: number;
    gid: number;
    secondaryGids?: number[];
  };
  tags?: Record<string, string>;
}

export interface EfsProviderOptions {
  credentialsProvider: AwsCredentialsProvider;
  logger: LoggerService;
}

export class EfsProvider {
  private readonly credentialsProvider: AwsCredentialsProvider;
  private readonly logger: LoggerService;

  constructor(options: EfsProviderOptions) {
    this.credentialsProvider = options.credentialsProvider;
    this.logger = options.logger;
  }

  private async getClient(accountName: string): Promise<EFSClient> {
    const account = this.credentialsProvider.getAccount(accountName);
    if (!account) {
      throw new Error(`Unknown AWS account: ${accountName}`);
    }

    return new EFSClient({
      region: account.region,
      credentials: this.credentialsProvider.getCredentialsProvider(accountName),
    });
  }

  async listFileSystems(accountName: string): Promise<EfsFileSystem[]> {
    const client = await this.getClient(accountName);
    const fileSystems: EfsFileSystem[] = [];
    let marker: string | undefined;

    do {
      const command = new DescribeFileSystemsCommand({ Marker: marker });
      const response = await client.send(command);

      for (const fs of response.FileSystems ?? []) {
        fileSystems.push(this.mapFileSystem(fs));
      }

      marker = response.NextMarker;
    } while (marker);

    this.logger.debug(`Listed ${fileSystems.length} EFS file systems for account ${accountName}`);
    return fileSystems;
  }

  async getFileSystem(accountName: string, fileSystemId: string): Promise<EfsFileSystem | undefined> {
    const client = await this.getClient(accountName);

    try {
      const command = new DescribeFileSystemsCommand({ FileSystemId: fileSystemId });
      const response = await client.send(command);

      if (!response.FileSystems || response.FileSystems.length === 0) {
        return undefined;
      }

      return this.mapFileSystem(response.FileSystems[0]);
    } catch (error: any) {
      if (error.name === 'FileSystemNotFound') {
        return undefined;
      }
      throw error;
    }
  }

  async listMountTargets(accountName: string, fileSystemId: string): Promise<EfsMountTarget[]> {
    const client = await this.getClient(accountName);
    const mountTargets: EfsMountTarget[] = [];
    let marker: string | undefined;

    do {
      const command = new DescribeMountTargetsCommand({
        FileSystemId: fileSystemId,
        Marker: marker,
      });
      const response = await client.send(command);

      for (const mt of response.MountTargets ?? []) {
        mountTargets.push(this.mapMountTarget(mt));
      }

      marker = response.NextMarker;
    } while (marker);

    return mountTargets;
  }

  async getLifecycleConfiguration(accountName: string, fileSystemId: string): Promise<EfsLifecyclePolicy[]> {
    const client = await this.getClient(accountName);

    try {
      const command = new DescribeLifecycleConfigurationCommand({ FileSystemId: fileSystemId });
      const response = await client.send(command);

      return (response.LifecyclePolicies ?? []).map(this.mapLifecyclePolicy);
    } catch (error: any) {
      if (error.name === 'FileSystemNotFound') {
        return [];
      }
      throw error;
    }
  }

  async listAccessPoints(accountName: string, fileSystemId?: string): Promise<EfsAccessPoint[]> {
    const client = await this.getClient(accountName);
    const accessPoints: EfsAccessPoint[] = [];
    let nextToken: string | undefined;

    do {
      const command = new DescribeAccessPointsCommand({
        FileSystemId: fileSystemId,
        NextToken: nextToken,
      });
      const response = await client.send(command);

      for (const ap of response.AccessPoints ?? []) {
        accessPoints.push(this.mapAccessPoint(ap));
      }

      nextToken = response.NextToken;
    } while (nextToken);

    return accessPoints;
  }

  private mapFileSystem(fs: FileSystemDescription): EfsFileSystem {
    const tags: Record<string, string> = {};
    for (const tag of fs.Tags ?? []) {
      if (tag.Key && tag.Value) {
        tags[tag.Key] = tag.Value;
      }
    }

    return {
      fileSystemId: fs.FileSystemId ?? '',
      fileSystemArn: fs.FileSystemArn ?? '',
      name: fs.Name,
      creationTime: fs.CreationTime ?? new Date(),
      lifeCycleState: fs.LifeCycleState ?? 'unknown',
      numberOfMountTargets: fs.NumberOfMountTargets ?? 0,
      sizeInBytes: fs.SizeInBytes?.Value ?? 0,
      performanceMode: fs.PerformanceMode ?? 'generalPurpose',
      throughputMode: fs.ThroughputMode ?? 'bursting',
      provisionedThroughputInMibps: fs.ProvisionedThroughputInMibps,
      encrypted: fs.Encrypted ?? false,
      kmsKeyId: fs.KmsKeyId,
      tags: Object.keys(tags).length > 0 ? tags : undefined,
    };
  }

  private mapMountTarget(mt: MountTargetDescription): EfsMountTarget {
    return {
      mountTargetId: mt.MountTargetId ?? '',
      fileSystemId: mt.FileSystemId ?? '',
      subnetId: mt.SubnetId ?? '',
      lifeCycleState: mt.LifeCycleState ?? 'unknown',
      ipAddress: mt.IpAddress,
      networkInterfaceId: mt.NetworkInterfaceId,
      availabilityZoneId: mt.AvailabilityZoneId,
      availabilityZoneName: mt.AvailabilityZoneName,
      vpcId: mt.VpcId,
    };
  }

  private mapLifecyclePolicy(lp: LifecyclePolicy): EfsLifecyclePolicy {
    return {
      transitionToIA: lp.TransitionToIA,
      transitionToPrimaryStorageClass: lp.TransitionToPrimaryStorageClass,
      transitionToArchive: lp.TransitionToArchive,
    };
  }

  private mapAccessPoint(ap: AccessPointDescription): EfsAccessPoint {
    const tags: Record<string, string> = {};
    for (const tag of ap.Tags ?? []) {
      if (tag.Key && tag.Value) {
        tags[tag.Key] = tag.Value;
      }
    }

    return {
      accessPointId: ap.AccessPointId ?? '',
      accessPointArn: ap.AccessPointArn ?? '',
      fileSystemId: ap.FileSystemId ?? '',
      name: ap.Name,
      lifeCycleState: ap.LifeCycleState ?? 'unknown',
      rootDirectory: ap.RootDirectory
        ? {
            path: ap.RootDirectory.Path,
            creationInfo: ap.RootDirectory.CreationInfo
              ? {
                  ownerUid: ap.RootDirectory.CreationInfo.OwnerUid ?? 0,
                  ownerGid: ap.RootDirectory.CreationInfo.OwnerGid ?? 0,
                  permissions: ap.RootDirectory.CreationInfo.Permissions ?? '0755',
                }
              : undefined,
          }
        : undefined,
      posixUser: ap.PosixUser
        ? {
            uid: ap.PosixUser.Uid ?? 0,
            gid: ap.PosixUser.Gid ?? 0,
            secondaryGids: ap.PosixUser.SecondaryGids,
          }
        : undefined,
      tags: Object.keys(tags).length > 0 ? tags : undefined,
    };
  }
}
