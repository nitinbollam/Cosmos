import { IsEnum, IsObject, IsOptional, IsString, MaxLength, MinLength } from 'class-validator'
import { NotificationChannel } from '../../generated/prisma-client'

export class SendNotificationDto {
  @IsEnum(NotificationChannel)
  channel!: NotificationChannel

  @IsString()
  @MinLength(1)
  @MaxLength(320)
  recipient!: string

  @IsString()
  @MinLength(1)
  @MaxLength(128)
  templateKey!: string

  @IsOptional()
  @IsObject()
  payload?: Record<string, unknown>
}
