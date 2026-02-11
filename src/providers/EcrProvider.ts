import { LoggerService } from '@backstage/backend-plugin-api';
import {
  ECRClient,
  DescribeRepositoriesCommand,
  DescribeImagesCommand,
  DescribeImageScanFindingsCommand,
  GetLifecyclePolicyCommand,
  GetRepositoryPolicyCommand,
  ListTagsForResourceCommand,
  Repository,
  ImageDetail,
  ImageScanFindings,
} from '@aws-sdk/client-ecr';
import { AwsCredentialsProvider } from '../credentials/AwsCredentialsProvider';

export interface EcrRepository {
  repositoryName: string;
  repositoryArn: string;
  repositoryUri: string;
  registryId: string;
  createdAt?: Date;
  imageTagMutability: string;
  scanOnPush: boolean;
  encryptionType?: string;
  kmsKey?: string;
  tags?: Record<string, string>;
}

export interface EcrImage {
  repositoryName: string;
  imageDigest: string;
  imageTags: string[];
  imageSizeInBytes: number;
  imagePushedAt?: Date;
  imageManifestMediaType?: string;
  lastRecordedPullTime?: Date;
  artifactMediaType?: string;
}

export interface EcrScanFinding {
  name: string;
  description?: string;
  severity: string;
  uri?: string;
}

export interface EcrScanSummary {
  imageDigest: string;
  imageTags: string[];
  scanCompletedAt?: Date;
  vulnerabilitySourceUpdatedAt?: Date;
  findingSeverityCounts: Record<string, number>;
  findings: EcrScanFinding[];
}

export interface EcrLifecyclePolicy {
  repositoryName: string;
  registryId: string;
  policyText: string;
  lastEvaluatedAt?: Date;
}

export interface EcrProviderOptions {
  credentialsProvider: AwsCredentialsProvider;
  logger: LoggerService;
}

export class EcrProvider {
  private readonly credentialsProvider: AwsCredentialsProvider;
  private readonly logger: LoggerService;

  constructor(options: EcrProviderOptions) {
    this.credentialsProvider = options.credentialsProvider;
    this.logger = options.logger;
  }

  private async getClient(accountName: string): Promise<ECRClient> {
    const account = this.credentialsProvider.getAccount(accountName);
    if (!account) {
      throw new Error(`Unknown AWS account: ${accountName}`);
    }

    return new ECRClient({
      region: account.region,
      credentials: this.credentialsProvider.getCredentialsProvider(accountName),
    });
  }

  async listRepositories(accountName: string): Promise<EcrRepository[]> {
    const client = await this.getClient(accountName);
    const repositories: EcrRepository[] = [];
    let nextToken: string | undefined;

    do {
      const command = new DescribeRepositoriesCommand({ nextToken });
      const response = await client.send(command);

      for (const repo of response.repositories ?? []) {
        const mapped = this.mapRepository(repo);
        // Fetch tags for each repository
        try {
          const tagsCommand = new ListTagsForResourceCommand({
            resourceArn: repo.repositoryArn,
          });
          const tagsResponse = await client.send(tagsCommand);
          if (tagsResponse.tags && tagsResponse.tags.length > 0) {
            mapped.tags = {};
            for (const tag of tagsResponse.tags) {
              if (tag.Key && tag.Value) {
                mapped.tags[tag.Key] = tag.Value;
              }
            }
          }
        } catch {
          // Tags not available
        }
        repositories.push(mapped);
      }

      nextToken = response.nextToken;
    } while (nextToken);

    this.logger.debug(`Listed ${repositories.length} ECR repositories for account ${accountName}`);
    return repositories;
  }

  async getRepository(accountName: string, repositoryName: string): Promise<EcrRepository | undefined> {
    const client = await this.getClient(accountName);

    try {
      const command = new DescribeRepositoriesCommand({
        repositoryNames: [repositoryName],
      });
      const response = await client.send(command);

      if (!response.repositories || response.repositories.length === 0) {
        return undefined;
      }

      const repo = response.repositories[0];
      const mapped = this.mapRepository(repo);

      // Fetch tags
      try {
        const tagsCommand = new ListTagsForResourceCommand({
          resourceArn: repo.repositoryArn,
        });
        const tagsResponse = await client.send(tagsCommand);
        if (tagsResponse.tags && tagsResponse.tags.length > 0) {
          mapped.tags = {};
          for (const tag of tagsResponse.tags) {
            if (tag.Key && tag.Value) {
              mapped.tags[tag.Key] = tag.Value;
            }
          }
        }
      } catch {
        // Tags not available
      }

      return mapped;
    } catch (error: any) {
      if (error.name === 'RepositoryNotFoundException') {
        return undefined;
      }
      throw error;
    }
  }

  async listImages(
    accountName: string,
    repositoryName: string,
    maxResults?: number,
  ): Promise<EcrImage[]> {
    const client = await this.getClient(accountName);
    const images: EcrImage[] = [];
    let nextToken: string | undefined;

    do {
      const command = new DescribeImagesCommand({
        repositoryName,
        nextToken,
        maxResults: maxResults ?? 100,
      });
      const response = await client.send(command);

      for (const image of response.imageDetails ?? []) {
        images.push(this.mapImage(repositoryName, image));
      }

      nextToken = response.nextToken;

      // Stop if we have enough
      if (maxResults && images.length >= maxResults) {
        break;
      }
    } while (nextToken);

    // Sort by push date, newest first
    images.sort((a, b) => {
      const dateA = a.imagePushedAt?.getTime() ?? 0;
      const dateB = b.imagePushedAt?.getTime() ?? 0;
      return dateB - dateA;
    });

    return maxResults ? images.slice(0, maxResults) : images;
  }

  async getImageScanFindings(
    accountName: string,
    repositoryName: string,
    imageDigest: string,
    imageTag?: string,
  ): Promise<EcrScanSummary | undefined> {
    const client = await this.getClient(accountName);

    try {
      const command = new DescribeImageScanFindingsCommand({
        repositoryName,
        imageId: {
          imageDigest,
          imageTag,
        },
      });
      const response = await client.send(command);

      if (!response.imageScanFindings) {
        return undefined;
      }

      return this.mapScanFindings(
        imageDigest,
        response.imageId?.imageTag ? [response.imageId.imageTag] : [],
        response.imageScanFindings,
      );
    } catch (error: any) {
      if (error.name === 'ScanNotFoundException' || error.name === 'ImageNotFoundException') {
        return undefined;
      }
      throw error;
    }
  }

  async getLifecyclePolicy(
    accountName: string,
    repositoryName: string,
  ): Promise<EcrLifecyclePolicy | undefined> {
    const client = await this.getClient(accountName);

    try {
      const command = new GetLifecyclePolicyCommand({ repositoryName });
      const response = await client.send(command);

      return {
        repositoryName: response.repositoryName ?? repositoryName,
        registryId: response.registryId ?? '',
        policyText: response.lifecyclePolicyText ?? '',
        lastEvaluatedAt: response.lastEvaluatedAt,
      };
    } catch (error: any) {
      if (error.name === 'LifecyclePolicyNotFoundException') {
        return undefined;
      }
      throw error;
    }
  }

  async getRepositoryPolicy(
    accountName: string,
    repositoryName: string,
  ): Promise<string | undefined> {
    const client = await this.getClient(accountName);

    try {
      const command = new GetRepositoryPolicyCommand({ repositoryName });
      const response = await client.send(command);
      return response.policyText;
    } catch (error: any) {
      if (error.name === 'RepositoryPolicyNotFoundException') {
        return undefined;
      }
      throw error;
    }
  }

  private mapRepository(repo: Repository): EcrRepository {
    return {
      repositoryName: repo.repositoryName ?? '',
      repositoryArn: repo.repositoryArn ?? '',
      repositoryUri: repo.repositoryUri ?? '',
      registryId: repo.registryId ?? '',
      createdAt: repo.createdAt,
      imageTagMutability: repo.imageTagMutability ?? 'MUTABLE',
      scanOnPush: repo.imageScanningConfiguration?.scanOnPush ?? false,
      encryptionType: repo.encryptionConfiguration?.encryptionType,
      kmsKey: repo.encryptionConfiguration?.kmsKey,
    };
  }

  private mapImage(repositoryName: string, image: ImageDetail): EcrImage {
    return {
      repositoryName,
      imageDigest: image.imageDigest ?? '',
      imageTags: image.imageTags ?? [],
      imageSizeInBytes: image.imageSizeInBytes ?? 0,
      imagePushedAt: image.imagePushedAt,
      imageManifestMediaType: image.imageManifestMediaType,
      lastRecordedPullTime: image.lastRecordedPullTime,
      artifactMediaType: image.artifactMediaType,
    };
  }

  private mapScanFindings(
    imageDigest: string,
    imageTags: string[],
    findings: ImageScanFindings,
  ): EcrScanSummary {
    const severityCounts: Record<string, number> = {};
    if (findings.findingSeverityCounts) {
      for (const [severity, count] of Object.entries(findings.findingSeverityCounts)) {
        severityCounts[severity] = count;
      }
    }

    return {
      imageDigest,
      imageTags,
      scanCompletedAt: findings.imageScanCompletedAt,
      vulnerabilitySourceUpdatedAt: findings.vulnerabilitySourceUpdatedAt,
      findingSeverityCounts: severityCounts,
      findings: (findings.findings ?? []).map(f => ({
        name: f.name ?? '',
        description: f.description,
        severity: f.severity ?? 'UNDEFINED',
        uri: f.uri,
      })),
    };
  }
}
