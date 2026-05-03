import { Module } from '@nestjs/common'
import { HttpModule } from '@nestjs/axios'
import { MSAEngine } from './msa.engine'
import { MSAController } from './msa.controller'
import { S3Service } from '../storage/s3.service'

@Module({
  imports: [HttpModule.register({ timeout: 30_000 })],
  controllers: [MSAController],
  providers: [MSAEngine, S3Service],
  exports: [MSAEngine, S3Service],
})
export class MSAModule {}
