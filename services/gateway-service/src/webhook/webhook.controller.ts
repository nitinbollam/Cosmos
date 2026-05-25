import {
  Controller,
  Get,
  Post,
  Delete,
  Body,
  Param,
  Req,
  HttpCode,
  HttpStatus,
  NotFoundException,
  BadRequestException,
  UseGuards,
} from '@nestjs/common'
import { SkipThrottle } from '@nestjs/throttler'
import { JwtAuthGuard } from '@cosmos/auth-middleware'
import type { AuthenticatedUser } from '@cosmos/types'
import { WebhookStoreService, WebhookSubscription } from './webhook-store.service'
import { randomUUID } from 'crypto'
import type { Request } from 'express'

import { IsOptional, IsString, IsUrl } from 'class-validator'

class CreateWebhookDto {
  @IsString()
  event!: string

  @IsUrl({ require_tld: false })
  url!: string

  @IsOptional()
  @IsString()
  description?: string
}

@Controller('webhooks')
@UseGuards(JwtAuthGuard)
export class WebhookController {
  constructor(private store: WebhookStoreService) {}

  @Get()
  async list(@Req() req: Request) {
    const user = req.user as AuthenticatedUser
    return this.store.list(user.tenantId)
  }

  @Post()
  @HttpCode(HttpStatus.CREATED)
  async create(@Req() req: Request, @Body() dto: CreateWebhookDto) {
    const user = req.user as AuthenticatedUser
    if (!dto.url || !dto.event) throw new BadRequestException('url and event are required')
    try {
      new URL(dto.url)
    } catch {
      throw new BadRequestException('url must be a valid URL')
    }

    const sub: WebhookSubscription = {
      id: randomUUID(),
      tenantId: user.tenantId,
      event: dto.event,
      url: dto.url,
      description: dto.description,
      active: true,
      createdAt: new Date().toISOString(),
    }
    await this.store.upsert(sub)
    return sub
  }

  @Delete(':id')
  @HttpCode(HttpStatus.NO_CONTENT)
  async remove(@Req() req: Request, @Param('id') id: string) {
    const user = req.user as AuthenticatedUser
    const existing = await this.store.get(user.tenantId, id)
    if (!existing) throw new NotFoundException('Webhook subscription not found')
    await this.store.delete(user.tenantId, id)
  }

  @Post(':id/test')
  @SkipThrottle()
  async test(@Req() req: Request, @Param('id') id: string) {
    const user = req.user as AuthenticatedUser
    const sub = await this.store.get(user.tenantId, id)
    if (!sub) throw new NotFoundException('Webhook subscription not found')

    const body = JSON.stringify({
      id: randomUUID(),
      event: 'webhook.test',
      tenantId: user.tenantId,
      timestamp: new Date().toISOString(),
      data: { message: 'This is a test webhook from Cosmos.' },
    })

    try {
      const res = await fetch(sub.url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-Cosmos-Event': 'webhook.test' },
        body,
        signal: AbortSignal.timeout(8000),
      })
      return { success: res.ok, status: res.status }
    } catch (err) {
      return { success: false, error: (err as Error).message }
    }
  }
}
