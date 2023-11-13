import * as pulumi from "@pulumi/pulumi";
import * as aws from "@pulumi/aws";
let config = new pulumi.Config();

// Retrieve the value of a specific configuration variable
let RELEASE_ARTIFACT = config.require("RELEASE_ARTIFACT");
let AWS_REGION = config.require("AWS_REGION");
let ACCOUNT_ID = config.require("ACCOUNT_ID")
let WEBAPP_NAME = config.require("WEBAPP_NAME")



const dotnetfunctionsLambdaRole = new aws.iam.Role('dotnetfunctions-IAMRole', {
    assumeRolePolicy: JSON.stringify({
        "Version" : "2012-10-17",
        "Statement" : [{
            "Effect" : "Allow", 
            "Action" : "sts:AssumeRole",
            "Principal": {
                "Service": "lambda.amazonaws.com",
            },
        }]
    })
});
// Secrets Manager and SSM Parameter Policy for Lambda
const ssmPolicyFordotnetFunctionLambda = new aws.iam.Policy("lambda_ssm_access_dotnetfunction", {
    description: "Allow lambda to access SSM",
    policy: JSON.stringify({
        Version: "2012-10-17",
        Statement: [{
            Effect: "Allow",
            Action: "ssm:GetParameter*",
            Resource: "arn:aws:ssm:" + AWS_REGION + ":" + ACCOUNT_ID + ":parameter/lambda/*",
        }],
    }),
});

const ssmAttachment = new aws.iam.RolePolicyAttachment("ssm_attachment_dotnetfunction", {
    role: dotnetfunctionsLambdaRole.name,
    policyArn: ssmPolicyFordotnetFunctionLambda.arn,
});

const dotnetfunctionsLambdaPolicy = new aws.iam.Policy("dotnetfunctionsLambdaPolicy", {
    description: "dotnet functions lambda policy",
    policy: JSON.stringify({
        Version: "2012-10-17",
        Statement: [
            {
                Action: [
                    "logs:CreateLogGroup",
                    "logs:CreateLogStream",
                    "logs:PutLogEvents",
                ],
                Effect: "Allow",
                Resource: "arn:aws:logs:*:*:*",
            },
        ],
    }),
});


const attachIamPolicyToIamRole = new aws.iam.RolePolicyAttachment("attachIamPolicyToIamRole", {
    role: dotnetfunctionsLambdaRole.name,
    policyArn: "arn:aws:iam::aws:policy/service-role/AWSLambdaVPCAccessExecutionRole",
});
const inkpreviewfunctionsLambdaRolePolicyAttachment = new aws.iam.RolePolicyAttachment(
    "dotnetfunctionsLambdaRolePolicyAttachment",
    {
        policyArn: dotnetfunctionsLambdaPolicy.arn,
        role: dotnetfunctionsLambdaRole.name,
    }
);


    
const bandlab_lambda_dotnetfunctions = new aws.lambda.Function("dotnetfunctions", {
    code: new pulumi.asset.FileArchive("/tmp/"+ WEBAPP_NAME + "/" + RELEASE_ARTIFACT),
    name: `dotnetfunctions-lambda`,
    role: dotnetfunctionsLambdaRole.arn,
    handler: "BandLab.dotnet.Function::BandLab.dotnet.Function.Function::FunctionHandler",
    runtime: "dotnet6",
    architectures: ["arm64"],
    tracingConfig: {
        mode: "Active",
    },
 
    timeout: 30,
    environment: {
        variables: {
            ASPNETCORE_ENVIRONMENT: "Development"
        }
    },
    memorySize: 512,
    layers: ["arn:aws:lambda:ap-southeast-1:044395824272:layer:AWS-Parameters-and-Secrets-Lambda-Extension-Arm64:11"]
});


export const bandlabLambdadotnetFunctions = bandlab_lambda_dotnetfunctions.arn
