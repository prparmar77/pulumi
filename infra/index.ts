import * as pulumi from "@pulumi/pulumi";
import * as aws from "@pulumi/aws";
let config = new pulumi.Config();

// Retrieve the value of a specific configuration variable
let RELEASE_ARTIFACT = config.require("RELEASE_ARTIFACT");

const bandlab_lambda = new aws.lambda.Function("bandcd-lambda", {
    code: new pulumi.asset.FileArchive(`/tmp/${{ RELEASE_ARTIFACT }}`),
    name: `bandlab-lambda`,
    handler: "index.lambda_handler",
    runtime: "dotnet6",
    architectures: ["arm64"],
    reservedConcurrentExecutions: 20,
    tracingConfig: {
        mode: "Active",
    },
});

