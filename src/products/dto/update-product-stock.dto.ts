import { Type } from 'class-transformer';
import { IsInt, Min } from 'class-validator';

export class UpdateProductStockDto {
  @Type(() => Number)
  @IsInt()
  @Min(0)
  stock: number;
}
