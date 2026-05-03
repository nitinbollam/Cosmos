import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Patch,
  Post,
  Query,
  Req,
  UseGuards,
} from '@nestjs/common'
import { UsersService } from './users.service'
import { CreateUserDto } from './dto/create-user.dto'
import { UpdateUserDto } from './dto/update-user.dto'
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard'
import { Roles, RolesGuard } from '../auth/guards/roles.guard'

@UseGuards(JwtAuthGuard, RolesGuard)
@Controller('users')
export class UsersController {
  constructor(private users: UsersService) {}

  @Get()
  list(
    @Req() req: { user: { tenantId: string } },
    @Query('page') page?: string,
    @Query('pageSize') pageSize?: string,
  ) {
    return this.users.list(
      req.user.tenantId,
      page ? parseInt(page, 10) : 1,
      pageSize ? parseInt(pageSize, 10) : 20,
    )
  }

  @Get(':id')
  get(@Req() req: { user: { tenantId: string } }, @Param('id') id: string) {
    return this.users.findById(req.user.tenantId, id)
  }

  @Roles('TENANT_ADMIN')
  @Post()
  create(@Req() req: { user: { tenantId: string } }, @Body() dto: CreateUserDto) {
    return this.users.create({ ...dto, tenantId: req.user.tenantId })
  }

  @Roles('TENANT_ADMIN')
  @Patch(':id')
  update(
    @Req() req: { user: { tenantId: string } },
    @Param('id') id: string,
    @Body() dto: UpdateUserDto,
  ) {
    return this.users.update(req.user.tenantId, id, dto)
  }

  @Roles('TENANT_ADMIN')
  @Delete(':id')
  deactivate(@Req() req: { user: { tenantId: string } }, @Param('id') id: string) {
    return this.users.deactivate(req.user.tenantId, id)
  }
}
