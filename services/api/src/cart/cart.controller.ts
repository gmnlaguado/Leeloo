import { Body, Controller, Post, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { AuthGuard } from '../auth/auth.guard';

@ApiTags('cart')
@Controller('cart')
@UseGuards(AuthGuard)
@ApiBearerAuth()
export class CartController {
  @Post('add')
  @ApiOperation({ summary: 'Add items to cart (stub)' })
  async add(@Body() body: { store: string; items: string }) {
    return {
      ok: true,
      mock: true,
      store: body.store,
      items: body.items,
    };
  }
}
