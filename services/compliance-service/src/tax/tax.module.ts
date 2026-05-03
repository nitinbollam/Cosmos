import { Module } from '@nestjs/common'
import { TaxController } from './tax.controller'

@Module({ controllers: [TaxController] })
export class TaxModule {}
