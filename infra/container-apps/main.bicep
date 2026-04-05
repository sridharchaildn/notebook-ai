targetScope = 'resourceGroup'

@description('Deployment location. Defaults to this resource group location.')
param location string = resourceGroup().location

@description('Naming prefix used for generated resources (ACR name is derived without hyphens).')
@minLength(3)
@maxLength(18)
param namePrefix string = 'notebook-ai'

@description('Container registry SKU.')
@allowed([
  'Basic'
  'Standard'
  'Premium'
])
param acrSku string = 'Basic'

@description('ACR image repository name (must match workflow image name without registry).')
param imageRepository string = 'notebook-ai-cloud-api'

@description('Container image tag.')
param imageTag string = 'latest'

@description('Set false to deploy only ACR + Container Apps environment first.')
param deployContainerApp bool = true

@description('Container port (matches services/cloud-api Dockerfile / uvicorn).')
param containerPort int = 8790

@description('Supabase project URL.')
param supabaseUrl string

@secure()
@description('Supabase service-role / secret key.')
param supabaseSecretKey string

@secure()
@description('Server credential encryption secret (NOTEBOOK_CLOUD_CREDENTIAL_SECRET).')
param credentialSecret string

@description('Comma-separated CORS origins (NOTEBOOK_CLOUD_ALLOWED_ORIGINS).')
param allowedOrigins string

@description('Optional build label (NOTEBOOK_CLOUD_BUILD_VERSION).')
param buildVersion string = ''

@secure()
@description('Optional Supabase JWT secret for HS256 verification.')
param supabaseJwtSecret string = ''

@description('OpenAI OAuth client ID.')
param openaiOauthClientId string = ''

@secure()
@description('OpenAI OAuth client secret.')
param openaiOauthClientSecret string = ''

@description('OpenAI OAuth token URL.')
param openaiOauthTokenUrl string = ''

@description('OpenAI OAuth redirect URI.')
param openaiOauthRedirectUri string = ''

@description('Google Drive OAuth client ID.')
param googleDriveClientId string = ''

@secure()
@description('Google Drive OAuth client secret.')
param googleDriveClientSecret string = ''

@description('Google Drive OAuth token URL.')
param googleDriveOauthTokenUrl string = ''

@description('Google Drive OAuth redirect URI.')
param googleDriveRedirectUri string = ''

@secure()
@description('Optional Supabase anon key (NOTEBOOK_CLOUD_SUPABASE_ANON_KEY).')
param supabaseAnonKey string = ''

@description('Optional Supabase JWKS URL (NOTEBOOK_CLOUD_SUPABASE_JWKS_URL).')
param supabaseJwksUrl string = ''

@description('OpenAI OAuth authorize URL override.')
param openaiOauthAuthorizeUrl string = ''

@description('OpenAI OAuth scope.')
param openaiOauthScope string = ''

@description('Google Drive OAuth authorize URL override.')
param googleDriveOauthAuthorizeUrl string = ''

@description('Google Drive OAuth scope.')
param googleDriveScope string = ''

@description('Default Drive folder name (NOTEBOOK_CLOUD_GOOGLE_DRIVE_DEFAULT_FOLDER_NAME).')
param googleDriveDefaultFolderName string = ''

@description('Enable verbose API logs (NOTEBOOK_CLOUD_DEBUG).')
param notebookCloudDebug bool = false

@description('Minimum Container App replicas to keep warm.')
@minValue(0)
param containerAppMinReplicas int = 0

var normalizedPrefix = toLower(replace(namePrefix, '-', ''))
var uniqueSuffix = toLower(uniqueString(subscription().id, resourceGroup().id, namePrefix))
var containerRegistryName = take('${normalizedPrefix}${uniqueSuffix}', 50)
var containerEnvironmentName = '${namePrefix}-cae'
var containerAppName = '${namePrefix}-cloud-api'
var logAnalyticsWorkspaceName = '${namePrefix}-logs'
var apiContainerName = 'cloud-api'

resource logAnalyticsWorkspace 'Microsoft.OperationalInsights/workspaces@2023-09-01' = {
  name: logAnalyticsWorkspaceName
  location: location
  properties: {
    sku: {
      name: 'PerGB2018'
    }
    retentionInDays: 30
  }
}

resource containerRegistry 'Microsoft.ContainerRegistry/registries@2023-07-01' = {
  name: containerRegistryName
  location: location
  sku: {
    name: acrSku
  }
  properties: {
    adminUserEnabled: true
    publicNetworkAccess: 'Enabled'
  }
}

var registryCredentials = containerRegistry.listCredentials()
var containerImage = '${containerRegistry.properties.loginServer}/${imageRepository}:${imageTag}'

resource containerAppsEnvironment 'Microsoft.App/managedEnvironments@2024-03-01' = {
  name: containerEnvironmentName
  location: location
  properties: {
    appLogsConfiguration: {
      destination: 'log-analytics'
      logAnalyticsConfiguration: {
        customerId: logAnalyticsWorkspace.properties.customerId
        sharedKey: logAnalyticsWorkspace.listKeys().primarySharedKey
      }
    }
  }
}

var optionalSecrets = concat(
  empty(supabaseAnonKey) ? [] : [
    {
      name: 'supabase-anon-key'
      value: supabaseAnonKey
    }
  ],
  empty(supabaseJwtSecret) ? [] : [
    {
      name: 'supabase-jwt-secret'
      value: supabaseJwtSecret
    }
  ],
  empty(openaiOauthClientSecret) ? [] : [
    {
      name: 'openai-oauth-client-secret'
      value: openaiOauthClientSecret
    }
  ],
  empty(googleDriveClientSecret) ? [] : [
    {
      name: 'google-drive-client-secret'
      value: googleDriveClientSecret
    }
  ]
)

var optionalEnvVars = concat(
  empty(buildVersion) ? [] : [
    {
      name: 'NOTEBOOK_CLOUD_BUILD_VERSION'
      value: buildVersion
    }
  ],
  empty(supabaseJwtSecret) ? [] : [
    {
      name: 'NOTEBOOK_CLOUD_SUPABASE_JWT_SECRET'
      secretRef: 'supabase-jwt-secret'
    }
  ],
  empty(openaiOauthClientId) ? [] : [
    {
      name: 'NOTEBOOK_CLOUD_OPENAI_OAUTH_CLIENT_ID'
      value: openaiOauthClientId
    }
  ],
  empty(openaiOauthClientSecret) ? [] : [
    {
      name: 'NOTEBOOK_CLOUD_OPENAI_OAUTH_CLIENT_SECRET'
      secretRef: 'openai-oauth-client-secret'
    }
  ],
  empty(openaiOauthTokenUrl) ? [] : [
    {
      name: 'NOTEBOOK_CLOUD_OPENAI_OAUTH_TOKEN_URL'
      value: openaiOauthTokenUrl
    }
  ],
  empty(openaiOauthRedirectUri) ? [] : [
    {
      name: 'NOTEBOOK_CLOUD_OPENAI_OAUTH_REDIRECT_URI'
      value: openaiOauthRedirectUri
    }
  ],
  empty(googleDriveClientId) ? [] : [
    {
      name: 'NOTEBOOK_CLOUD_GOOGLE_DRIVE_CLIENT_ID'
      value: googleDriveClientId
    }
  ],
  empty(googleDriveClientSecret) ? [] : [
    {
      name: 'NOTEBOOK_CLOUD_GOOGLE_DRIVE_CLIENT_SECRET'
      secretRef: 'google-drive-client-secret'
    }
  ],
  empty(googleDriveOauthTokenUrl) ? [] : [
    {
      name: 'NOTEBOOK_CLOUD_GOOGLE_DRIVE_OAUTH_TOKEN_URL'
      value: googleDriveOauthTokenUrl
    }
  ],
  empty(googleDriveRedirectUri) ? [] : [
    {
      name: 'NOTEBOOK_CLOUD_GOOGLE_DRIVE_REDIRECT_URI'
      value: googleDriveRedirectUri
    }
  ],
  empty(supabaseAnonKey) ? [] : [
    {
      name: 'NOTEBOOK_CLOUD_SUPABASE_ANON_KEY'
      secretRef: 'supabase-anon-key'
    }
  ],
  empty(supabaseJwksUrl) ? [] : [
    {
      name: 'NOTEBOOK_CLOUD_SUPABASE_JWKS_URL'
      value: supabaseJwksUrl
    }
  ],
  empty(openaiOauthAuthorizeUrl) ? [] : [
    {
      name: 'NOTEBOOK_CLOUD_OPENAI_OAUTH_AUTHORIZE_URL'
      value: openaiOauthAuthorizeUrl
    }
  ],
  empty(openaiOauthScope) ? [] : [
    {
      name: 'NOTEBOOK_CLOUD_OPENAI_OAUTH_SCOPE'
      value: openaiOauthScope
    }
  ],
  empty(googleDriveOauthAuthorizeUrl) ? [] : [
    {
      name: 'NOTEBOOK_CLOUD_GOOGLE_DRIVE_OAUTH_AUTHORIZE_URL'
      value: googleDriveOauthAuthorizeUrl
    }
  ],
  empty(googleDriveScope) ? [] : [
    {
      name: 'NOTEBOOK_CLOUD_GOOGLE_DRIVE_SCOPE'
      value: googleDriveScope
    }
  ],
  empty(googleDriveDefaultFolderName) ? [] : [
    {
      name: 'NOTEBOOK_CLOUD_GOOGLE_DRIVE_DEFAULT_FOLDER_NAME'
      value: googleDriveDefaultFolderName
    }
  ],
  notebookCloudDebug ? [
    {
      name: 'NOTEBOOK_CLOUD_DEBUG'
      value: 'true'
    }
  ] : []
)

resource containerApp 'Microsoft.App/containerApps@2024-03-01' = if (deployContainerApp) {
  name: containerAppName
  location: location
  properties: {
    managedEnvironmentId: containerAppsEnvironment.id
    configuration: {
      activeRevisionsMode: 'Single'
      ingress: {
        external: true
        allowInsecure: false
        targetPort: containerPort
        transport: 'auto'
        traffic: [
          {
            latestRevision: true
            weight: 100
          }
        ]
      }
      secrets: concat([
        {
          name: 'acr-password'
          value: registryCredentials.passwords[0].value
        }
        {
          name: 'supabase-secret-key'
          value: supabaseSecretKey
        }
        {
          name: 'credential-secret'
          value: credentialSecret
        }
      ], optionalSecrets)
      registries: [
        {
          server: containerRegistry.properties.loginServer
          username: registryCredentials.username
          passwordSecretRef: 'acr-password'
        }
      ]
    }
    template: {
      containers: [
        {
          name: apiContainerName
          image: containerImage
          resources: {
            cpu: json('0.5')
            memory: '1.0Gi'
          }
          env: concat([
            {
              name: 'PORT'
              value: string(containerPort)
            }
            {
              name: 'NOTEBOOK_CLOUD_SUPABASE_URL'
              value: supabaseUrl
            }
            {
              name: 'NOTEBOOK_CLOUD_SUPABASE_SECRET_KEY'
              secretRef: 'supabase-secret-key'
            }
            {
              name: 'NOTEBOOK_CLOUD_CREDENTIAL_SECRET'
              secretRef: 'credential-secret'
            }
            {
              name: 'NOTEBOOK_CLOUD_ALLOWED_ORIGINS'
              value: allowedOrigins
            }
          ], optionalEnvVars)
          probes: [
            {
              type: 'Startup'
              httpGet: {
                path: '/health'
                port: containerPort
              }
              initialDelaySeconds: 0
              periodSeconds: 10
              failureThreshold: 30
            }
            {
              type: 'Liveness'
              httpGet: {
                path: '/health'
                port: containerPort
              }
              initialDelaySeconds: 20
              periodSeconds: 30
              failureThreshold: 3
            }
            {
              type: 'Readiness'
              httpGet: {
                path: '/health'
                port: containerPort
              }
              initialDelaySeconds: 5
              periodSeconds: 10
              failureThreshold: 3
            }
          ]
        }
      ]
      scale: {
        minReplicas: containerAppMinReplicas
        maxReplicas: 3
        rules: [
          {
            name: 'http-scaling'
            http: {
              metadata: {
                concurrentRequests: '50'
              }
            }
          }
        ]
      }
    }
  }
}

output containerAppName string = deployContainerApp ? containerApp!.name : ''
output containerAppUrl string = deployContainerApp ? 'https://${containerApp!.properties.configuration.ingress.fqdn}' : ''
output containerRegistryName string = containerRegistry.name
output containerRegistryLoginServer string = containerRegistry.properties.loginServer
output containerImage string = containerImage
