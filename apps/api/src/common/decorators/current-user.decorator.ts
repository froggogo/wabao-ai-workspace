import { createParamDecorator, ExecutionContext } from '@nestjs/common';
import { AuthedRequest } from '../guards/jwt-auth.guard';

export interface CurrentUserData {
  id: string;
  email: string;
}

export const CurrentUser = createParamDecorator(
  (_data: unknown, ctx: ExecutionContext): CurrentUserData => {
    const req = ctx.switchToHttp().getRequest<AuthedRequest>();
    return req.user;
  },
);
