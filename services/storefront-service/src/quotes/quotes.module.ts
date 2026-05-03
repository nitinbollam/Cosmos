import { HttpModule } from '@nestjs/axios'
import { Module } from '@nestjs/common'
import { QuoteToOrderBridge } from './quote-to-order.bridge'
import { QuotesController } from './quotes.controller'
import { QuotesService } from './quotes.service'

@Module({
  imports: [HttpModule],
  controllers: [QuotesController],
  providers: [QuotesService, QuoteToOrderBridge],
  exports: [QuotesService],
})
export class QuotesModule {}
