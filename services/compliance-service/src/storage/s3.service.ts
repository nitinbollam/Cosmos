import { Injectable } from '@nestjs/common'
import { ConfigService } from '@nestjs/config'
import { S3Client, PutObjectCommand, GetObjectCommand } from '@aws-sdk/client-s3'
import { logger } from '@cosmos/logger'

@Injectable()
export class S3Service {
  private client: S3Client
  private bucket: string

  constructor(config: ConfigService) {
    this.bucket = config.get<string>('AWS_S3_BUCKET') ?? 'cosmos-documents-dev'
    const region = config.get<string>('AWS_REGION') ?? 'us-east-1'
    const endpoint = config.get<string>('AWS_S3_ENDPOINT') // local MinIO override
    this.client = new S3Client({
      region,
      ...(endpoint ? { endpoint, forcePathStyle: true } : {}),
      credentials:
        config.get('AWS_ACCESS_KEY_ID') && config.get('AWS_SECRET_ACCESS_KEY')
          ? {
              accessKeyId: config.get<string>('AWS_ACCESS_KEY_ID')!,
              secretAccessKey: config.get<string>('AWS_SECRET_ACCESS_KEY')!,
            }
          : undefined,
    })
  }

  async uploadText(key: string, content: string, contentType = 'text/plain'): Promise<void> {
    await this.client.send(
      new PutObjectCommand({
        Bucket: this.bucket,
        Key: key,
        Body: content,
        ContentType: contentType,
      }),
    )
    logger.info({ key, bucket: this.bucket }, 's3 upload ok')
  }

  async getText(key: string): Promise<string> {
    const out = await this.client.send(new GetObjectCommand({ Bucket: this.bucket, Key: key }))
    return (await out.Body?.transformToString()) ?? ''
  }
}
