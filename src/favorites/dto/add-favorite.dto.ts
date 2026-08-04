import { IsNotEmpty, IsString, IsUUID } from 'class-validator';

export class AddFavoriteDto {
  @IsString()
  @IsNotEmpty()
  @IsUUID()
  productId: string;
}
