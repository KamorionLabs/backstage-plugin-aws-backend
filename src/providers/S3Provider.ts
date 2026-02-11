import { LoggerService } from '@backstage/backend-plugin-api';
import {
  S3Client,
  ListBucketsCommand,
  GetBucketLocationCommand,
  GetBucketVersioningCommand,
  GetBucketEncryptionCommand,
  GetBucketLifecycleConfigurationCommand,
  GetBucketTaggingCommand,
  GetBucketPolicyStatusCommand,
  GetPublicAccessBlockCommand,
  Bucket,
  LifecycleRule,
  ServerSideEncryptionRule,
} from '@aws-sdk/client-s3';
import { AwsCredentialsProvider } from '../credentials/AwsCredentialsProvider';

export interface S3Bucket {
  name: string;
  creationDate?: Date;
  region?: string;
  versioningEnabled: boolean;
  mfaDeleteEnabled: boolean;
  encryptionEnabled: boolean;
  encryptionType?: string;
  kmsKeyId?: string;
  lifecycleRules: S3LifecycleRule[];
  publicAccessBlocked: boolean;
  policyIsPublic: boolean;
  tags?: Record<string, string>;
}

export interface S3LifecycleRule {
  id: string;
  status: string;
  prefix?: string;
  filter?: {
    prefix?: string;
    tags?: Record<string, string>;
  };
  transitions: Array<{
    days?: number;
    date?: Date;
    storageClass: string;
  }>;
  expiration?: {
    days?: number;
    date?: Date;
    expiredObjectDeleteMarker?: boolean;
  };
  noncurrentVersionTransitions: Array<{
    noncurrentDays?: number;
    newerNoncurrentVersions?: number;
    storageClass: string;
  }>;
  noncurrentVersionExpiration?: {
    noncurrentDays?: number;
    newerNoncurrentVersions?: number;
  };
  abortIncompleteMultipartUpload?: {
    daysAfterInitiation: number;
  };
}

export interface S3ProviderOptions {
  credentialsProvider: AwsCredentialsProvider;
  logger: LoggerService;
}

export class S3Provider {
  private readonly credentialsProvider: AwsCredentialsProvider;
  private readonly logger: LoggerService;

  constructor(options: S3ProviderOptions) {
    this.credentialsProvider = options.credentialsProvider;
    this.logger = options.logger;
  }

  private async getClient(accountName: string): Promise<S3Client> {
    const account = this.credentialsProvider.getAccount(accountName);
    if (!account) {
      throw new Error(`Unknown AWS account: ${accountName}`);
    }

    return new S3Client({
      region: account.region,
      credentials: this.credentialsProvider.getCredentialsProvider(accountName),
    });
  }

  async listBuckets(accountName: string): Promise<S3Bucket[]> {
    const client = await this.getClient(accountName);
    const command = new ListBucketsCommand({});
    const response = await client.send(command);

    const buckets: S3Bucket[] = [];

    for (const bucket of response.Buckets ?? []) {
      if (bucket.Name) {
        buckets.push(await this.getBucketBasicInfo(accountName, bucket));
      }
    }

    this.logger.debug(`Listed ${buckets.length} S3 buckets for account ${accountName}`);
    return buckets;
  }

  async getBucket(accountName: string, bucketName: string): Promise<S3Bucket | undefined> {
    const client = await this.getClient(accountName);

    try {
      // Get basic bucket info
      const bucket: S3Bucket = {
        name: bucketName,
        versioningEnabled: false,
        mfaDeleteEnabled: false,
        encryptionEnabled: false,
        lifecycleRules: [],
        publicAccessBlocked: false,
        policyIsPublic: false,
      };

      // Get region
      try {
        const locationCommand = new GetBucketLocationCommand({ Bucket: bucketName });
        const locationResponse = await client.send(locationCommand);
        bucket.region = locationResponse.LocationConstraint || 'us-east-1';
      } catch {
        // Region not available
      }

      // Get versioning
      try {
        const versioningCommand = new GetBucketVersioningCommand({ Bucket: bucketName });
        const versioningResponse = await client.send(versioningCommand);
        bucket.versioningEnabled = versioningResponse.Status === 'Enabled';
        bucket.mfaDeleteEnabled = versioningResponse.MFADelete === 'Enabled';
      } catch {
        // Versioning not available
      }

      // Get encryption
      try {
        const encryptionCommand = new GetBucketEncryptionCommand({ Bucket: bucketName });
        const encryptionResponse = await client.send(encryptionCommand);
        const rules = encryptionResponse.ServerSideEncryptionConfiguration?.Rules ?? [];
        if (rules.length > 0) {
          bucket.encryptionEnabled = true;
          const encryption = this.mapEncryptionRule(rules[0]);
          bucket.encryptionType = encryption.type;
          bucket.kmsKeyId = encryption.kmsKeyId;
        }
      } catch (error: any) {
        if (error.name !== 'ServerSideEncryptionConfigurationNotFoundError') {
          // Encryption not configured is OK
        }
      }

      // Get lifecycle rules
      try {
        const lifecycleCommand = new GetBucketLifecycleConfigurationCommand({ Bucket: bucketName });
        const lifecycleResponse = await client.send(lifecycleCommand);
        bucket.lifecycleRules = (lifecycleResponse.Rules ?? []).map(r => this.mapLifecycleRule(r));
      } catch (error: any) {
        if (error.name !== 'NoSuchLifecycleConfiguration') {
          // No lifecycle is OK
        }
      }

      // Get public access block
      try {
        const publicAccessCommand = new GetPublicAccessBlockCommand({ Bucket: bucketName });
        const publicAccessResponse = await client.send(publicAccessCommand);
        const config = publicAccessResponse.PublicAccessBlockConfiguration;
        bucket.publicAccessBlocked =
          config?.BlockPublicAcls === true &&
          config?.BlockPublicPolicy === true &&
          config?.IgnorePublicAcls === true &&
          config?.RestrictPublicBuckets === true;
      } catch (error: any) {
        if (error.name !== 'NoSuchPublicAccessBlockConfiguration') {
          // No public access block is OK (bucket is potentially public)
        }
      }

      // Get policy status
      try {
        const policyStatusCommand = new GetBucketPolicyStatusCommand({ Bucket: bucketName });
        const policyStatusResponse = await client.send(policyStatusCommand);
        bucket.policyIsPublic = policyStatusResponse.PolicyStatus?.IsPublic ?? false;
      } catch (error: any) {
        if (error.name !== 'NoSuchBucketPolicy') {
          // No policy is OK
        }
      }

      // Get tags
      try {
        const tagsCommand = new GetBucketTaggingCommand({ Bucket: bucketName });
        const tagsResponse = await client.send(tagsCommand);
        if (tagsResponse.TagSet && tagsResponse.TagSet.length > 0) {
          bucket.tags = {};
          for (const tag of tagsResponse.TagSet) {
            if (tag.Key && tag.Value) {
              bucket.tags[tag.Key] = tag.Value;
            }
          }
        }
      } catch (error: any) {
        if (error.name !== 'NoSuchTagSet') {
          // No tags is OK
        }
      }

      return bucket;
    } catch (error: any) {
      if (error.name === 'NoSuchBucket') {
        return undefined;
      }
      throw error;
    }
  }

  async listBucketsWithDetails(accountName: string): Promise<S3Bucket[]> {
    const client = await this.getClient(accountName);
    const command = new ListBucketsCommand({});
    const response = await client.send(command);

    const buckets: S3Bucket[] = [];

    // Fetch details in batches to avoid rate limiting
    const bucketNames = (response.Buckets ?? [])
      .map(b => b.Name)
      .filter((name): name is string => !!name);

    const batchSize = 5;
    for (let i = 0; i < bucketNames.length; i += batchSize) {
      const batch = bucketNames.slice(i, i + batchSize);
      const batchResults = await Promise.all(
        batch.map(name => this.getBucket(accountName, name)),
      );
      buckets.push(...batchResults.filter((b): b is S3Bucket => b !== undefined));
    }

    return buckets;
  }

  private async getBucketBasicInfo(_accountName: string, bucket: Bucket): Promise<S3Bucket> {
    // Return basic info without making additional API calls
    // Use getBucket() for full details
    return {
      name: bucket.Name ?? '',
      creationDate: bucket.CreationDate,
      versioningEnabled: false,
      mfaDeleteEnabled: false,
      encryptionEnabled: false,
      lifecycleRules: [],
      publicAccessBlocked: false,
      policyIsPublic: false,
    };
  }

  private mapEncryptionRule(rule: ServerSideEncryptionRule): { type: string; kmsKeyId?: string } {
    const sse = rule.ApplyServerSideEncryptionByDefault;
    return {
      type: sse?.SSEAlgorithm ?? 'AES256',
      kmsKeyId: sse?.KMSMasterKeyID,
    };
  }

  private mapLifecycleRule(rule: LifecycleRule): S3LifecycleRule {
    return {
      id: rule.ID ?? '',
      status: rule.Status ?? 'Disabled',
      prefix: rule.Prefix,
      filter: rule.Filter
        ? {
            prefix: rule.Filter.Prefix,
            tags: rule.Filter.Tag
              ? { [rule.Filter.Tag.Key ?? '']: rule.Filter.Tag.Value ?? '' }
              : undefined,
          }
        : undefined,
      transitions: (rule.Transitions ?? []).map(t => ({
        days: t.Days,
        date: t.Date,
        storageClass: t.StorageClass ?? '',
      })),
      expiration: rule.Expiration
        ? {
            days: rule.Expiration.Days,
            date: rule.Expiration.Date,
            expiredObjectDeleteMarker: rule.Expiration.ExpiredObjectDeleteMarker,
          }
        : undefined,
      noncurrentVersionTransitions: (rule.NoncurrentVersionTransitions ?? []).map(t => ({
        noncurrentDays: t.NoncurrentDays,
        newerNoncurrentVersions: t.NewerNoncurrentVersions,
        storageClass: t.StorageClass ?? '',
      })),
      noncurrentVersionExpiration: rule.NoncurrentVersionExpiration
        ? {
            noncurrentDays: rule.NoncurrentVersionExpiration.NoncurrentDays,
            newerNoncurrentVersions: rule.NoncurrentVersionExpiration.NewerNoncurrentVersions,
          }
        : undefined,
      abortIncompleteMultipartUpload: rule.AbortIncompleteMultipartUpload
        ? {
            daysAfterInitiation: rule.AbortIncompleteMultipartUpload.DaysAfterInitiation ?? 0,
          }
        : undefined,
    };
  }
}
