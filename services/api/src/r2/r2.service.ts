import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PutObjectCommand, S3Client } from '@aws-sdk/client-s3';

@Injectable()
export class R2Service {
  private readonly client: S3Client;
  private readonly bucket: string;
  private readonly publicBaseUrl: string;

  constructor(private readonly configService: ConfigService) {
    const endpoint = this.configService.get<string>('R2_ENDPOINT');
    const accessKeyId = this.configService.get<string>('R2_ACCESS_KEY_ID');
    const secretAccessKey = this.configService.get<string>('R2_SECRET_ACCESS_KEY');
    const bucket = this.configService.get<string>('R2_BUCKET_NAME');
    const publicBaseUrl = this.configService.get<string>('R2_PUBLIC_BASE_URL');

    if (!endpoint) {
      throw new Error('R2_ENDPOINT is not configured');
    }
    if (!accessKeyId || !secretAccessKey) {
      throw new Error('R2 credentials are not configured');
    }
    if (!bucket) {
      throw new Error('R2_BUCKET_NAME is not configured');
    }
    if (!publicBaseUrl) {
      throw new Error('R2_PUBLIC_BASE_URL is not configured');
    }

    this.bucket = bucket;
    this.publicBaseUrl = publicBaseUrl.replace(/\/+$/, '');

    this.client = new S3Client({
      region: 'auto',
      endpoint,
      credentials: { accessKeyId, secretAccessKey },
    });
  }

  async putPublicObject(params: {
    key: string;
    body: Buffer;
    contentType: string;
  }): Promise<{ url: string }>
  {
    await this.client.send(
      new PutObjectCommand({
        Bucket: this.bucket,
        Key: params.key,
        Body: params.body,
        ContentType: params.contentType,
      }),
    );

    const url = `${this.publicBaseUrl}/${params.key}`;
    return { url };
  }
}
