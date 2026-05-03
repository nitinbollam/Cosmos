import { Injectable, UnauthorizedException } from '@nestjs/common'
import { PassportStrategy } from '@nestjs/passport'
import { Strategy } from 'passport-local'
import { AuthService } from '../auth.service'

@Injectable()
export class LocalStrategy extends PassportStrategy(Strategy, 'local') {
  constructor(private auth: AuthService) {
    super({ usernameField: 'email' })
  }

  async validate(email: string, password: string) {
    try {
      return await this.auth.login({ email, password })
    } catch {
      throw new UnauthorizedException('Invalid credentials')
    }
  }
}
