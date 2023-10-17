import * as pulumi from "@pulumi/pulumi";
import * as aws from "@pulumi/aws";
import * as awsx from "@pulumi/awsx";

const vpcId = "vpc-06e13f0e48b1bb55c"; // Use your specific VPC ID

const subnet = ["subnet-08168024aa2a94b5b"]

const existingVpc = aws.ec2.getVpc({ id: vpcId });

const securityGroup = ["sg-06c29f2d69ec5015c"]

// Create an AWS resource (S3 Bucket)
const bucket = new aws.s3.Bucket("BandLab-bucket");

// Export the name of the bucket and check if the bucket is created
export const bucketName = bucket.id;

// Create a KMS Key for encryption
const key = new aws.kms.Key("BandLabkey", {
    deletionWindowInDays: 10, // Change to your preferred value
    description: "This key is used to encrypt secret",
});

// Create an AWS resource (SQS Queue)
const BandLabQueue = new aws.sqs.Queue("BandLabQueue", {});

// Export the name of the queue
export const queueName = BandLabQueue.name;

// Create an AWS SNS Topic
const BandLabTopic = new aws.sns.Topic("BandLabTopic", {});

// Export the name of the queue and the Topic
export const topicName = BandLabTopic.name;

// IAM Role for Lambda execution
const assumeRole = aws.iam.getPolicyDocument({
    statements: [{
        actions: ["sts:AssumeRole"],
        principals: [{
            type: "Service",
            identifiers: ["lambda.amazonaws.com"],
        }],
    }],
});
const bandlabLambdaRole = new aws.iam.Role("bandlabLambdaRole", {
    assumeRolePolicy: assumeRole.then(assumeRole => assumeRole.json),
    name: "BandLab-IAMRole",
});
const attachIamPolicyToIamRole = new aws.iam.RolePolicyAttachment("attachIamPolicyToIamRole", {
    role: bandlabLambdaRole.name,
    policyArn: "arn:aws:iam::aws:policy/service-role/AWSLambdaVPCAccessExecutionRole",
});

// Lambda Function

const bandlab_lambda = new aws.lambda.Function("bandlab-lambda", {
    code: new pulumi.asset.FileArchive(`DummyLambdaCode.zip`),
    name: `bandlab-lambda`,
    role: bandlabLambdaRole.arn,
    handler: "index.lambda_handler",
    runtime: "dotnet6",
    architectures: ["arm64"],
    reservedConcurrentExecutions: 20,
    tracingConfig: {
        mode: "Active",
    },
});

const kmsReadPolicy = new aws.iam.Policy("kmsReadPolicy", {policy: `{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Action": [
        "kms:GetPublicKey",        
        "kms:GetKeyRotationStatus",
        "kms:GetKeyPolicy",
        "kms:DescribeKey",
        "kms:ListKeyPolicies",
        "kms:ListResourceTags",
        "tag:GetResources",
        "sqs:SendMessage"
      ],
      "Effect": "Allow",
      "Resource": "*"
    }
  ]
}
`});
const kmsReadPolicyAttachment = new aws.iam.RolePolicyAttachment("kmsReadPolicyAttachment", {
    role: bandlabLambdaRole.name,
    policyArn: kmsReadPolicy.arn,
});
const sqsQueueExecutionRolePolicy = aws.iam.getPolicy({
    arn: "arn:aws:iam::aws:policy/service-role/AWSLambdaSQSQueueExecutionRole",
});
//SQSQueueExecutionRole
const sqsQueueExecutionRolePolicyAttachment = new aws.iam.RolePolicyAttachment("sqsQueueExecutionRolePolicyAttachment", {
    role: bandlabLambdaRole.name,
    policyArn: sqsQueueExecutionRolePolicy.then(sqsQueueExecutionRolePolicy => sqsQueueExecutionRolePolicy.arn),
});

//DynamoDBExecutionRole
const dynamodbPolicy = aws.iam.getPolicy({
    arn: "arn:aws:iam::aws:policy/service-role/AWSLambdaSQSQueueExecutionRole",
});
const dynamodbPolicyResource = new aws.iam.RolePolicyAttachment("dynamodbPolicyResource", {
    role: bandlabLambdaRole.name,
    policyArn: dynamodbPolicy.then(dynamodbPolicy => dynamodbPolicy.arn),
});


// API Gateway

const api = new aws.apigateway.RestApi("api", {name: `bandlab-api`});

const demo = new aws.apigateway.Resource("demo", {
    pathPart: "servicemessage",
    parentId: api.rootResourceId,
    restApi: api.id
});

const integration = new aws.apigateway.Integration("integration", {
    restApi: api.id,
    resourceId: demo.id,
    httpMethod: "POST",
    integrationHttpMethod: "POST",
    type: "AWS",
    uri: bandlab_lambda.invokeArn
});

const method = new aws.apigateway.Method("method", {
    restApi: api.id,
    resourceId: demo.id,
    httpMethod: "POST",
    authorization: "NONE",
    requestModels: {
        "application/json": "Empty"
    },
    apiKeyRequired: false
});

const response200 = new aws.apigateway.MethodResponse("response200", {
    restApi: api.id,
    resourceId: demo.id,
    httpMethod: method.httpMethod,
    statusCode: "200"
});
const apigw = new aws.lambda.Permission("apigw", {
    statementId: "AllowAPIGatewayInvoke",
    action: "lambda:InvokeFunction",
    function: bandlab_lambda.name,
    principal: "apigateway.amazonaws.com",
    sourceArn: api.executionArn,
});

const apideploy = new aws.apigateway.Deployment("apideploy", {
    restApi: api.id,
    stageName: "dev",
},
   { dependsOn: [method, integration] });


// Create a CloudFront distribution with the API Gateway as the origin

const originAccessIdentity = new aws.cloudfront.OriginAccessIdentity('OAI');

//domainName: api.executionArn.apply(arn => arn.split(":").slice(3, 5).join("."))

const Distribution = new aws.cloudfront.Distribution('distribution', {
    enabled: true,
    origins: [
        {
            domainName: api.executionArn.apply(arn => arn.split(":").slice(3, 5).join(".")),
            customOriginConfig: {
                httpPort: 80,
                httpsPort: 443,
                originProtocolPolicy: 'https-only',
                originSslProtocols: ['TLSv1.2'],
            },
            originPath: '',
            originId: api.id,
        },
    ],
    defaultRootObject: method.httpMethod,
    defaultCacheBehavior: {
        targetOriginId: api.id,

        viewerProtocolPolicy: 'redirect-to-https',
        allowedMethods: ['GET', 'HEAD', 'OPTIONS'],
        cachedMethods: ['GET', 'HEAD', 'OPTIONS'],

        forwardedValues: {
            queryString: false,
            cookies: {
                forward: 'none',
            },
        },

        minTtl: 0,
        defaultTtl: 3600,
        maxTtl: 86400,
    },
    restrictions: {
        geoRestriction: {
            restrictionType: 'none',
        },
    },
    viewerCertificate: {
        cloudfrontDefaultCertificate: true,
    },
});


//Create ElasticCache Redis Cluster

const subnetGroup = new aws.elasticache.SubnetGroup("cacheSubnetGroup", {
    subnetIds: subnet,
});

const cluster = new aws.elasticache.Cluster("BandLabCluster", {
    engine: "redis",
    nodeType: "cache.t2.micro",    
    numCacheNodes: 1,              
    parameterGroupName: "default.redis7",  
    engineVersion: "7.0",       
    port: 6379,                     
    subnetGroupName: subnetGroup.name
});

// Create OpenSearch

const openSearchDomain = new aws.elasticsearch.Domain("BandLabDomain", {
    elasticsearchVersion: "7.1",
    clusterConfig: {
        instanceType: "t3.small.elasticsearch",
        dedicatedMasterType: "t3.medium.search",
    },
    ebsOptions: {
        ebsEnabled: true,
        volumeSize: 10
    },
    vpcOptions: {
        subnetIds: subnet,
        securityGroupIds: securityGroup,
    }
});


// Create a Secret with encryption using the above KMS Key
const secret = new aws.secretsmanager.Secret("BandLabSecret", {
    kmsKeyId: key.keyId,
});

const SecretVersion = new aws.secretsmanager.SecretVersion("BandLabSecretVersion", {
    secretId: secret.id,
    secretString: "HelloWorld",
});

export const secretArn = secret.arn;
export const kmsKeyArn = key.arn;
export const elasticCacheEndpoint = cluster.cacheNodes.apply(nodes => nodes[0].address);
export const openSearchEndpoint = openSearchDomain.endpoint;


