import { Module } from '@nestjs/common';
import { ShoppingListController } from './shopping-list.controller';
import { ShoppingListService } from './shopping-list.service';
import { DatabaseModule } from '../database/database.module';
import { ProfilesModule } from '../profiles/profiles.module';

@Module({
  imports: [DatabaseModule, ProfilesModule],
  controllers: [ShoppingListController],
  providers: [ShoppingListService],
  exports: [ShoppingListService],
})
export class ShoppingListModule {}
