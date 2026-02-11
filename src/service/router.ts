import { Router } from 'express';
import { errorHandler } from '@backstage/backend-common';
import { Config } from '@backstage/config';
import { LoggerService } from '@backstage/backend-plugin-api';
import { AwsCredentialsProvider } from '../credentials/AwsCredentialsProvider';
import { LambdaProvider } from '../providers/LambdaProvider';
import { EcsProvider } from '../providers/EcsProvider';
import { SsmProvider } from '../providers/SsmProvider';
import { SecretsManagerProvider } from '../providers/SecretsManagerProvider';
import { EfsProvider } from '../providers/EfsProvider';
import { RdsProvider } from '../providers/RdsProvider';
import { DocumentDbProvider } from '../providers/DocumentDbProvider';
import { DynamoDbProvider } from '../providers/DynamoDbProvider';
import { S3Provider } from '../providers/S3Provider';
import { ApiGatewayProvider } from '../providers/ApiGatewayProvider';
import { EcrProvider } from '../providers/EcrProvider';

export interface RouterOptions {
  config: Config;
  logger: LoggerService;
}

function errorToString(error: unknown): string {
  if (error instanceof Error) {
    return error.message;
  }
  return String(error);
}

export async function createRouter(options: RouterOptions): Promise<Router> {
  const { config, logger } = options;
  const router = Router();

  const credentialsProvider = new AwsCredentialsProvider({ config, logger });
  const lambdaProvider = new LambdaProvider({ credentialsProvider, logger });
  const ecsProvider = new EcsProvider({ credentialsProvider, logger });
  const ssmProvider = new SsmProvider({ credentialsProvider, logger });
  const secretsProvider = new SecretsManagerProvider({ credentialsProvider, logger });
  const efsProvider = new EfsProvider({ credentialsProvider, logger });
  const rdsProvider = new RdsProvider({ credentialsProvider, logger });
  const documentDbProvider = new DocumentDbProvider({ credentialsProvider, logger });
  const dynamoDbProvider = new DynamoDbProvider({ credentialsProvider, logger });
  const s3Provider = new S3Provider({ credentialsProvider, logger });
  const apiGatewayProvider = new ApiGatewayProvider({ credentialsProvider, logger });
  const ecrProvider = new EcrProvider({ credentialsProvider, logger });

  router.get('/health', (_, res) => {
    res.json({ status: 'ok' });
  });

  router.get('/accounts', (_, res) => {
    const accounts = credentialsProvider.getAccounts().map(a => ({
      name: a.name,
      accountId: a.accountId,
      region: a.region,
    }));
    res.json(accounts);
  });

  // Lambda endpoints
  router.get('/lambda/:account', async (req, res) => {
    const { account } = req.params;
    try {
      const functions = await lambdaProvider.listFunctions(account);
      res.json(functions);
    } catch (error) {
      logger.error('Failed to list Lambda functions', { account, error: errorToString(error) });
      throw error;
    }
  });

  router.get('/lambda/:account/:functionName', async (req, res) => {
    const { account, functionName } = req.params;
    try {
      const fn = await lambdaProvider.getFunction(account, functionName);
      if (!fn) {
        res.status(404).json({ error: 'Function not found' });
        return;
      }
      res.json(fn);
    } catch (error) {
      logger.error('Failed to get Lambda function', { account, functionName, error: errorToString(error) });
      throw error;
    }
  });

  router.get('/lambda/:account/:functionName/versions', async (req, res) => {
    const { account, functionName } = req.params;
    try {
      const versions = await lambdaProvider.listVersions(account, functionName);
      res.json(versions);
    } catch (error) {
      logger.error('Failed to list Lambda versions', { account, functionName, error: errorToString(error) });
      throw error;
    }
  });

  // ECS endpoints
  router.get('/ecs/:account/clusters', async (req, res) => {
    const { account } = req.params;
    try {
      const clusters = await ecsProvider.listClusters(account);
      res.json(clusters);
    } catch (error) {
      logger.error('Failed to list ECS clusters', { account, error: errorToString(error) });
      throw error;
    }
  });

  router.get('/ecs/:account/:cluster/services', async (req, res) => {
    const { account, cluster } = req.params;
    try {
      const services = await ecsProvider.listServices(account, cluster);
      res.json(services);
    } catch (error) {
      logger.error('Failed to list ECS services', { account, cluster, error: errorToString(error) });
      throw error;
    }
  });

  router.get('/ecs/:account/:cluster/:service', async (req, res) => {
    const { account, cluster, service } = req.params;
    try {
      const svc = await ecsProvider.getService(account, cluster, service);
      if (!svc) {
        res.status(404).json({ error: 'Service not found' });
        return;
      }
      res.json(svc);
    } catch (error) {
      logger.error('Failed to get ECS service', { account, cluster, service, error: errorToString(error) });
      throw error;
    }
  });

  router.get('/ecs/:account/:cluster/:service/task-definition', async (req, res) => {
    const { account, cluster, service } = req.params;
    try {
      const svc = await ecsProvider.getService(account, cluster, service);
      if (!svc) {
        res.status(404).json({ error: 'Service not found' });
        return;
      }
      const taskDef = await ecsProvider.getTaskDefinition(account, svc.taskDefinition);
      if (!taskDef) {
        res.status(404).json({ error: 'Task definition not found' });
        return;
      }
      res.json(taskDef);
    } catch (error) {
      logger.error('Failed to get task definition', { account, cluster, service, error: errorToString(error) });
      throw error;
    }
  });

  // SSM Parameter Store endpoints
  router.get('/ssm/:account/parameter', async (req, res) => {
    const { account } = req.params;
    const { name, decrypt } = req.query;
    if (!name || typeof name !== 'string') {
      res.status(400).json({ error: 'Missing required query parameter: name' });
      return;
    }
    try {
      const param = await ssmProvider.getParameter(account, name, decrypt === 'true');
      if (!param) {
        res.status(404).json({ error: 'Parameter not found' });
        return;
      }
      res.json(param);
    } catch (error) {
      logger.error('Failed to get SSM parameter', { account, name, error: errorToString(error) });
      throw error;
    }
  });

  router.get('/ssm/:account/parameters', async (req, res) => {
    const { account } = req.params;
    const { path, recursive, decrypt } = req.query;
    if (!path || typeof path !== 'string') {
      res.status(400).json({ error: 'Missing required query parameter: path' });
      return;
    }
    try {
      const params = await ssmProvider.getParametersByPath(
        account,
        path,
        recursive !== 'false',
        decrypt === 'true',
      );
      res.json(params);
    } catch (error) {
      logger.error('Failed to get SSM parameters by path', { account, path, error: errorToString(error) });
      throw error;
    }
  });

  // Secrets Manager endpoints
  router.get('/secrets/:account', async (req, res) => {
    const { account } = req.params;
    try {
      const secrets = await secretsProvider.listSecrets(account);
      res.json(secrets);
    } catch (error) {
      logger.error('Failed to list secrets', { account, error: errorToString(error) });
      throw error;
    }
  });

  router.get('/secrets/:account/:secretName', async (req, res) => {
    const { account, secretName } = req.params;
    try {
      const secret = await secretsProvider.getSecret(account, secretName);
      if (!secret) {
        res.status(404).json({ error: 'Secret not found' });
        return;
      }
      res.json(secret);
    } catch (error) {
      logger.error('Failed to get secret', { account, secretName, error: errorToString(error) });
      throw error;
    }
  });

  router.get('/secrets/:account/:secretName/structure', async (req, res) => {
    const { account, secretName } = req.params;
    try {
      const structure = await secretsProvider.getSecretStructure(account, secretName);
      if (!structure) {
        res.status(404).json({ error: 'Secret not found' });
        return;
      }
      res.json(structure);
    } catch (error) {
      logger.error('Failed to get secret structure', { account, secretName, error: errorToString(error) });
      throw error;
    }
  });

  // ==========================================================================
  // Phase 1B - Data & Storage endpoints
  // ==========================================================================

  // EFS endpoints
  router.get('/efs/:account', async (req, res) => {
    const { account } = req.params;
    try {
      const fileSystems = await efsProvider.listFileSystems(account);
      res.json(fileSystems);
    } catch (error) {
      logger.error('Failed to list EFS file systems', { account, error: errorToString(error) });
      throw error;
    }
  });

  router.get('/efs/:account/:fileSystemId', async (req, res) => {
    const { account, fileSystemId } = req.params;
    try {
      const fs = await efsProvider.getFileSystem(account, fileSystemId);
      if (!fs) {
        res.status(404).json({ error: 'File system not found' });
        return;
      }
      res.json(fs);
    } catch (error) {
      logger.error('Failed to get EFS file system', { account, fileSystemId, error: errorToString(error) });
      throw error;
    }
  });

  router.get('/efs/:account/:fileSystemId/mounts', async (req, res) => {
    const { account, fileSystemId } = req.params;
    try {
      const mounts = await efsProvider.listMountTargets(account, fileSystemId);
      res.json(mounts);
    } catch (error) {
      logger.error('Failed to list EFS mount targets', { account, fileSystemId, error: errorToString(error) });
      throw error;
    }
  });

  router.get('/efs/:account/:fileSystemId/lifecycle', async (req, res) => {
    const { account, fileSystemId } = req.params;
    try {
      const lifecycle = await efsProvider.getLifecycleConfiguration(account, fileSystemId);
      res.json(lifecycle);
    } catch (error) {
      logger.error('Failed to get EFS lifecycle config', { account, fileSystemId, error: errorToString(error) });
      throw error;
    }
  });

  router.get('/efs/:account/access-points', async (req, res) => {
    const { account } = req.params;
    const { fileSystemId } = req.query;
    try {
      const accessPoints = await efsProvider.listAccessPoints(
        account,
        typeof fileSystemId === 'string' ? fileSystemId : undefined,
      );
      res.json(accessPoints);
    } catch (error) {
      logger.error('Failed to list EFS access points', { account, error: errorToString(error) });
      throw error;
    }
  });

  // RDS endpoints
  router.get('/rds/:account/instances', async (req, res) => {
    const { account } = req.params;
    try {
      const instances = await rdsProvider.listInstances(account);
      res.json(instances);
    } catch (error) {
      logger.error('Failed to list RDS instances', { account, error: errorToString(error) });
      throw error;
    }
  });

  router.get('/rds/:account/instances/:identifier', async (req, res) => {
    const { account, identifier } = req.params;
    try {
      const instance = await rdsProvider.getInstance(account, identifier);
      if (!instance) {
        res.status(404).json({ error: 'Instance not found' });
        return;
      }
      res.json(instance);
    } catch (error) {
      logger.error('Failed to get RDS instance', { account, identifier, error: errorToString(error) });
      throw error;
    }
  });

  router.get('/rds/:account/clusters', async (req, res) => {
    const { account } = req.params;
    try {
      const clusters = await rdsProvider.listClusters(account);
      res.json(clusters);
    } catch (error) {
      logger.error('Failed to list RDS clusters', { account, error: errorToString(error) });
      throw error;
    }
  });

  router.get('/rds/:account/clusters/:identifier', async (req, res) => {
    const { account, identifier } = req.params;
    try {
      const cluster = await rdsProvider.getCluster(account, identifier);
      if (!cluster) {
        res.status(404).json({ error: 'Cluster not found' });
        return;
      }
      res.json(cluster);
    } catch (error) {
      logger.error('Failed to get RDS cluster', { account, identifier, error: errorToString(error) });
      throw error;
    }
  });

  router.get('/rds/:account/parameter-groups', async (req, res) => {
    const { account } = req.params;
    try {
      const groups = await rdsProvider.listParameterGroups(account);
      res.json(groups);
    } catch (error) {
      logger.error('Failed to list RDS parameter groups', { account, error: errorToString(error) });
      throw error;
    }
  });

  router.get('/rds/:account/snapshots', async (req, res) => {
    const { account } = req.params;
    const { dbInstanceIdentifier } = req.query;
    try {
      const snapshots = await rdsProvider.listSnapshots(
        account,
        typeof dbInstanceIdentifier === 'string' ? dbInstanceIdentifier : undefined,
      );
      res.json(snapshots);
    } catch (error) {
      logger.error('Failed to list RDS snapshots', { account, error: errorToString(error) });
      throw error;
    }
  });

  // DocumentDB endpoints
  router.get('/docdb/:account/clusters', async (req, res) => {
    const { account } = req.params;
    try {
      const clusters = await documentDbProvider.listClusters(account);
      res.json(clusters);
    } catch (error) {
      logger.error('Failed to list DocumentDB clusters', { account, error: errorToString(error) });
      throw error;
    }
  });

  router.get('/docdb/:account/clusters/:identifier', async (req, res) => {
    const { account, identifier } = req.params;
    try {
      const cluster = await documentDbProvider.getCluster(account, identifier);
      if (!cluster) {
        res.status(404).json({ error: 'Cluster not found' });
        return;
      }
      res.json(cluster);
    } catch (error) {
      logger.error('Failed to get DocumentDB cluster', { account, identifier, error: errorToString(error) });
      throw error;
    }
  });

  router.get('/docdb/:account/instances', async (req, res) => {
    const { account } = req.params;
    try {
      const instances = await documentDbProvider.listInstances(account);
      res.json(instances);
    } catch (error) {
      logger.error('Failed to list DocumentDB instances', { account, error: errorToString(error) });
      throw error;
    }
  });

  router.get('/docdb/:account/parameter-groups', async (req, res) => {
    const { account } = req.params;
    try {
      const groups = await documentDbProvider.listParameterGroups(account);
      res.json(groups);
    } catch (error) {
      logger.error('Failed to list DocumentDB parameter groups', { account, error: errorToString(error) });
      throw error;
    }
  });

  // DynamoDB endpoints
  router.get('/dynamodb/:account/tables', async (req, res) => {
    const { account } = req.params;
    const { details } = req.query;
    try {
      if (details === 'true') {
        const tables = await dynamoDbProvider.listTablesWithDetails(account);
        res.json(tables);
      } else {
        const tableNames = await dynamoDbProvider.listTables(account);
        res.json(tableNames);
      }
    } catch (error) {
      logger.error('Failed to list DynamoDB tables', { account, error: errorToString(error) });
      throw error;
    }
  });

  router.get('/dynamodb/:account/tables/:tableName', async (req, res) => {
    const { account, tableName } = req.params;
    try {
      const table = await dynamoDbProvider.getTable(account, tableName);
      if (!table) {
        res.status(404).json({ error: 'Table not found' });
        return;
      }
      res.json(table);
    } catch (error) {
      logger.error('Failed to get DynamoDB table', { account, tableName, error: errorToString(error) });
      throw error;
    }
  });

  // S3 endpoints
  router.get('/s3/:account', async (req, res) => {
    const { account } = req.params;
    const { details } = req.query;
    try {
      if (details === 'true') {
        const buckets = await s3Provider.listBucketsWithDetails(account);
        res.json(buckets);
      } else {
        const buckets = await s3Provider.listBuckets(account);
        res.json(buckets);
      }
    } catch (error) {
      logger.error('Failed to list S3 buckets', { account, error: errorToString(error) });
      throw error;
    }
  });

  router.get('/s3/:account/:bucketName', async (req, res) => {
    const { account, bucketName } = req.params;
    try {
      const bucket = await s3Provider.getBucket(account, bucketName);
      if (!bucket) {
        res.status(404).json({ error: 'Bucket not found' });
        return;
      }
      res.json(bucket);
    } catch (error) {
      logger.error('Failed to get S3 bucket', { account, bucketName, error: errorToString(error) });
      throw error;
    }
  });

  // ==========================================================================
  // Phase 1C - API & Registry endpoints
  // ==========================================================================

  // API Gateway REST (v1) endpoints
  router.get('/apigateway/:account/rest-apis', async (req, res) => {
    const { account } = req.params;
    try {
      const apis = await apiGatewayProvider.listRestApis(account);
      res.json(apis);
    } catch (error) {
      logger.error('Failed to list REST APIs', { account, error: errorToString(error) });
      throw error;
    }
  });

  router.get('/apigateway/:account/rest-apis/:apiId', async (req, res) => {
    const { account, apiId } = req.params;
    try {
      const api = await apiGatewayProvider.getRestApi(account, apiId);
      if (!api) {
        res.status(404).json({ error: 'REST API not found' });
        return;
      }
      res.json(api);
    } catch (error) {
      logger.error('Failed to get REST API', { account, apiId, error: errorToString(error) });
      throw error;
    }
  });

  router.get('/apigateway/:account/rest-apis/:apiId/stages', async (req, res) => {
    const { account, apiId } = req.params;
    try {
      const stages = await apiGatewayProvider.getRestApiStages(account, apiId);
      res.json(stages);
    } catch (error) {
      logger.error('Failed to get REST API stages', { account, apiId, error: errorToString(error) });
      throw error;
    }
  });

  router.get('/apigateway/:account/rest-apis/:apiId/resources', async (req, res) => {
    const { account, apiId } = req.params;
    try {
      const resources = await apiGatewayProvider.getRestApiResources(account, apiId);
      res.json(resources);
    } catch (error) {
      logger.error('Failed to get REST API resources', { account, apiId, error: errorToString(error) });
      throw error;
    }
  });

  // API Gateway HTTP (v2) endpoints
  router.get('/apigateway/:account/http-apis', async (req, res) => {
    const { account } = req.params;
    try {
      const apis = await apiGatewayProvider.listHttpApis(account);
      res.json(apis);
    } catch (error) {
      logger.error('Failed to list HTTP APIs', { account, error: errorToString(error) });
      throw error;
    }
  });

  router.get('/apigateway/:account/http-apis/:apiId', async (req, res) => {
    const { account, apiId } = req.params;
    try {
      const api = await apiGatewayProvider.getHttpApi(account, apiId);
      if (!api) {
        res.status(404).json({ error: 'HTTP API not found' });
        return;
      }
      res.json(api);
    } catch (error) {
      logger.error('Failed to get HTTP API', { account, apiId, error: errorToString(error) });
      throw error;
    }
  });

  router.get('/apigateway/:account/http-apis/:apiId/stages', async (req, res) => {
    const { account, apiId } = req.params;
    try {
      const stages = await apiGatewayProvider.getHttpApiStages(account, apiId);
      res.json(stages);
    } catch (error) {
      logger.error('Failed to get HTTP API stages', { account, apiId, error: errorToString(error) });
      throw error;
    }
  });

  router.get('/apigateway/:account/http-apis/:apiId/routes', async (req, res) => {
    const { account, apiId } = req.params;
    try {
      const routes = await apiGatewayProvider.getHttpApiRoutes(account, apiId);
      res.json(routes);
    } catch (error) {
      logger.error('Failed to get HTTP API routes', { account, apiId, error: errorToString(error) });
      throw error;
    }
  });

  // ECR endpoints
  router.get('/ecr/:account', async (req, res) => {
    const { account } = req.params;
    try {
      const repositories = await ecrProvider.listRepositories(account);
      res.json(repositories);
    } catch (error) {
      logger.error('Failed to list ECR repositories', { account, error: errorToString(error) });
      throw error;
    }
  });

  router.get('/ecr/:account/:repositoryName', async (req, res) => {
    const { account, repositoryName } = req.params;
    try {
      const repo = await ecrProvider.getRepository(account, repositoryName);
      if (!repo) {
        res.status(404).json({ error: 'Repository not found' });
        return;
      }
      res.json(repo);
    } catch (error) {
      logger.error('Failed to get ECR repository', { account, repositoryName, error: errorToString(error) });
      throw error;
    }
  });

  router.get('/ecr/:account/:repositoryName/images', async (req, res) => {
    const { account, repositoryName } = req.params;
    const maxResults = req.query.maxResults ? parseInt(req.query.maxResults as string, 10) : undefined;
    try {
      const images = await ecrProvider.listImages(account, repositoryName, maxResults);
      res.json(images);
    } catch (error) {
      logger.error('Failed to list ECR images', { account, repositoryName, error: errorToString(error) });
      throw error;
    }
  });

  router.get('/ecr/:account/:repositoryName/scan/:imageDigest', async (req, res) => {
    const { account, repositoryName, imageDigest } = req.params;
    const { imageTag } = req.query;
    try {
      const findings = await ecrProvider.getImageScanFindings(
        account,
        repositoryName,
        imageDigest,
        typeof imageTag === 'string' ? imageTag : undefined,
      );
      if (!findings) {
        res.status(404).json({ error: 'Scan findings not found' });
        return;
      }
      res.json(findings);
    } catch (error) {
      logger.error('Failed to get ECR scan findings', { account, repositoryName, imageDigest, error: errorToString(error) });
      throw error;
    }
  });

  router.get('/ecr/:account/:repositoryName/lifecycle-policy', async (req, res) => {
    const { account, repositoryName } = req.params;
    try {
      const policy = await ecrProvider.getLifecyclePolicy(account, repositoryName);
      if (!policy) {
        res.status(404).json({ error: 'Lifecycle policy not found' });
        return;
      }
      res.json(policy);
    } catch (error) {
      logger.error('Failed to get ECR lifecycle policy', { account, repositoryName, error: errorToString(error) });
      throw error;
    }
  });

  router.use(errorHandler());
  return router;
}
