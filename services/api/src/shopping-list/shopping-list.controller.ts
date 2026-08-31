import { Body, Controller, Delete, Get, Param, Post, Query, Req, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { AuthGuard } from '../auth/auth.guard';
import { ShoppingListService, ShoppingStore } from './shopping-list.service';

type AuthedRequest = { user?: { id: string } };

@ApiTags('shopping-list')
@Controller('shopping-list')
@UseGuards(AuthGuard)
@ApiBearerAuth()
export class ShoppingListController {
  constructor(private readonly shoppingService: ShoppingListService) {}

  @Post('add')
  @ApiOperation({ summary: 'Add items to a shopping list' })
  async add(
    @Req() req: AuthedRequest,
    @Body() body: { items: string | string[]; store?: ShoppingStore },
  ) {
    const userId = req.user?.id;
    if (!userId) return { ok: false, error: 'Unauthenticated' };
    const rawItems = Array.isArray(body.items)
      ? body.items
      : String(body.items).split(',');
    const added = await this.shoppingService.addItems(userId, rawItems, body.store ?? 'general');
    return { ok: true, added };
  }

  @Get()
  @ApiOperation({ summary: 'Get shopping list items' })
  async list(@Req() req: AuthedRequest, @Query('store') store?: ShoppingStore) {
    const userId = req.user?.id;
    if (!userId) return { ok: false, items: [] };
    const items = await this.shoppingService.getItems(userId, store);
    return { ok: true, items };
  }

  @Post(':id/check')
  @ApiOperation({ summary: 'Mark an item as purchased' })
  async check(@Req() req: AuthedRequest, @Param('id') id: string) {
    const userId = req.user?.id;
    if (!userId) return { ok: false, error: 'Unauthenticated' };
    const item = await this.shoppingService.checkItem(userId, id);
    return { ok: true, item };
  }

  @Delete('clear/:store')
  @ApiOperation({ summary: 'Clear all items from a store list' })
  async clear(@Req() req: AuthedRequest, @Param('store') store: ShoppingStore) {
    const userId = req.user?.id;
    if (!userId) return { ok: false, error: 'Unauthenticated' };
    await this.shoppingService.clearStore(userId, store);
    return { ok: true };
  }
}
