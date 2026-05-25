import { Module } from '@nestjs/common'
import { WebhookStoreService } from './webhook-store.service'
import { WebhookPublisherService } from './webhook-publisher.service'
import { WebhookController } from './webhook.controller'

@Module({
  providers: [WebhookStoreService, WebhookPublisherService],
  controllers: [WebhookController],
  exports: [WebhookStoreService],
})
export class WebhookModule {}
