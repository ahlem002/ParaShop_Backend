import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Patch,
  Post,
  UploadedFiles,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { FilesInterceptor } from '@nestjs/platform-express';
import { diskStorage } from 'multer';
import { existsSync, mkdirSync } from 'fs';
import { extname, join } from 'path';
import { Role } from '../common/enums/role.enum';
import { Roles } from '../auth/decorators/roles.decorator';
import { RolesGuard } from '../auth/guards/roles.guard';
import { ApprovedCompanyGuard } from '../auth/guards/approved-company.guard';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import type { JwtPayload } from '../auth/interfaces/jwt-payload.interface';
import { ProductsService } from './products.service';
import { CreateProductDto } from './dto/create-product.dto';
import { UpdateProductDto } from './dto/update-product.dto';
import { UpdateProductStockDto } from './dto/update-product-stock.dto';

const productsDir = join(process.cwd(), 'uploads', 'products');

if (!existsSync(productsDir)) {
  mkdirSync(productsDir, { recursive: true });
}

function makeFilename(
  _req: unknown,
  file: Express.Multer.File,
  callback: (error: Error | null, filename: string) => void,
) {
  const unique = `${Date.now()}-${Math.round(Math.random() * 1e9)}`;
  callback(null, `${unique}${extname(file.originalname)}`);
}

const imageUpload = FilesInterceptor('images', 5, {
  storage: diskStorage({
    destination: productsDir,
    filename: makeFilename,
  }),
  fileFilter: (_req, file, callback) => {
    const allowed = /\.(png|jpe?g|webp)$/i.test(file.originalname);
    if (!allowed) {
      callback(
        new BadRequestException('Product images must be png, jpg, or webp'),
        false,
      );
      return;
    }
    callback(null, true);
  },
  limits: { fileSize: 5 * 1024 * 1024 },
});

@Controller('company/products')
@UseGuards(AuthGuard('jwt'), RolesGuard, ApprovedCompanyGuard)
@Roles(Role.COMPANY)
export class ProductsController {
  constructor(private readonly productsService: ProductsService) {}

  @Get()
  findAll(@CurrentUser() user: JwtPayload) {
    return this.productsService.findMyProducts(user.sub);
  }

  @Get(':productId')
  findOne(
    @Param('productId') productId: string,
    @CurrentUser() user: JwtPayload,
  ) {
    return this.productsService.findOneForCompany(productId, user.sub);
  }

  @Post()
  @UseInterceptors(imageUpload)
  create(
    @CurrentUser() user: JwtPayload,
    @Body() dto: CreateProductDto,
    @UploadedFiles() images?: Express.Multer.File[],
  ) {
    const imagePaths = (images ?? []).map(
      (file) => `/uploads/products/${file.filename}`,
    );

    return this.productsService.create(user.sub, dto, imagePaths);
  }

  @Patch(':productId/stock')
  updateStock(
    @Param('productId') productId: string,
    @CurrentUser() user: JwtPayload,
    @Body() dto: UpdateProductStockDto,
  ) {
    return this.productsService.updateStock(productId, user.sub, dto.stock);
  }

  @Patch(':productId')
  @UseInterceptors(imageUpload)
  update(
    @Param('productId') productId: string,
    @CurrentUser() user: JwtPayload,
    @Body() dto: UpdateProductDto,
    @UploadedFiles() images?: Express.Multer.File[],
  ) {
    const imagePaths = images?.length
      ? images.map((file) => `/uploads/products/${file.filename}`)
      : undefined;

    return this.productsService.update(productId, user.sub, dto, imagePaths);
  }

  @Delete(':productId')
  remove(
    @Param('productId') productId: string,
    @CurrentUser() user: JwtPayload,
  ) {
    return this.productsService.remove(productId, user.sub);
  }
}
