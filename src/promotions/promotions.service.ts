import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
  OnModuleInit,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { In, IsNull, LessThanOrEqual, MoreThan, Repository } from 'typeorm';
import { Company } from '../companies/entities/company.entity';
import { Product } from '../products/entities/product.entity';
import { PromotionOfferType } from '../common/enums/promotion-offer-type.enum';
import { PromotionStatus } from '../common/enums/promotion-status.enum';
import { VerificationStatus } from '../common/enums/verification-status.enum';
import { PromotionCampaign } from './entities/promotion-campaign.entity';
import { PromotionCampaignProduct } from './entities/promotion-campaign-product.entity';
import { PromotionOffer } from './entities/promotion-offer.entity';
import { PromotionPriceOverride } from './entities/promotion-price-override.entity';
import {
  CreatePriceOverrideDto,
  CreatePromotionCampaignDto,
  UpdatePromotionOfferDto,
} from './dto/promotion.dto';

const DEFAULT_OFFERS: Array<{
  offerType: PromotionOfferType;
  name: string;
  description: string;
  defaultPrice: number;
  defaultDurationDays: number;
}> = [
  {
    offerType: PromotionOfferType.CATEGORY_BOOST,
    name: 'Category boost',
    description: 'Show your product first in its category.',
    defaultPrice: 20,
    defaultDurationDays: 7,
  },
  {
    offerType: PromotionOfferType.SEARCH_BOOST,
    name: 'Search boost',
    description: 'Appear first in matching search results.',
    defaultPrice: 15,
    defaultDurationDays: 7,
  },
  {
    offerType: PromotionOfferType.HOME_SPOTLIGHT,
    name: 'Home spotlight',
    description: 'Feature your product on the home page.',
    defaultPrice: 30,
    defaultDurationDays: 7,
  },
  {
    offerType: PromotionOfferType.PACK,
    name: 'Product pack',
    description: 'Promote 2+ products together (category + search + home).',
    defaultPrice: 50,
    defaultDurationDays: 14,
  },
];

@Injectable()
export class PromotionsService implements OnModuleInit {
  constructor(
    @InjectRepository(PromotionOffer)
    private readonly offersRepository: Repository<PromotionOffer>,
    @InjectRepository(PromotionPriceOverride)
    private readonly overridesRepository: Repository<PromotionPriceOverride>,
    @InjectRepository(PromotionCampaign)
    private readonly campaignsRepository: Repository<PromotionCampaign>,
    @InjectRepository(PromotionCampaignProduct)
    private readonly campaignProductsRepository: Repository<PromotionCampaignProduct>,
    @InjectRepository(Product)
    private readonly productsRepository: Repository<Product>,
    @InjectRepository(Company)
    private readonly companiesRepository: Repository<Company>,
  ) {}

  async onModuleInit() {
    for (const offer of DEFAULT_OFFERS) {
      const existing = await this.offersRepository.findOne({
        where: { offerType: offer.offerType },
      });
      if (!existing) {
        await this.offersRepository.save(this.offersRepository.create(offer));
      }
    }
  }

  async listOffers() {
    return this.offersRepository.find({ order: { name: 'ASC' } });
  }

  async updateOffer(offerId: string, dto: UpdatePromotionOfferDto) {
    const offer = await this.offersRepository.findOne({ where: { offerId } });
    if (!offer) throw new NotFoundException('Offer not found');

    if (dto.name !== undefined) offer.name = dto.name.trim();
    if (dto.description !== undefined) {
      offer.description = dto.description.trim() || null;
    }
    if (dto.defaultPrice !== undefined) offer.defaultPrice = dto.defaultPrice;
    if (dto.defaultDurationDays !== undefined) {
      offer.defaultDurationDays = dto.defaultDurationDays;
    }
    if (dto.isActive !== undefined) offer.isActive = dto.isActive;

    return this.offersRepository.save(offer);
  }

  async listOverrides() {
    return this.overridesRepository.find({
      relations: { product: true, admin: true },
      order: { createdAt: 'DESC' },
    });
  }

  async createOverride(adminUserId: string, dto: CreatePriceOverrideDto) {
    const offer = await this.offersRepository.findOne({
      where: { offerType: dto.offerType },
    });
    if (!offer) throw new NotFoundException('Offer type not found');

    let productId: string | null = dto.productId?.trim() || null;
    if (productId) {
      const product = await this.productsRepository.findOne({
        where: { productId },
      });
      if (!product) throw new NotFoundException('Product not found');
    }

    // Deactivate previous matching overrides
    const existing = await this.overridesRepository.find({
      where: productId
        ? { offerType: dto.offerType, productId, isActive: true }
        : { offerType: dto.offerType, productId: IsNull(), isActive: true },
    });
    for (const row of existing) {
      row.isActive = false;
      await this.overridesRepository.save(row);
    }

    return this.overridesRepository.save(
      this.overridesRepository.create({
        offerType: dto.offerType,
        productId,
        price: dto.price,
        durationDays: dto.durationDays ?? null,
        reason: dto.reason.trim(),
        adminUserId,
        isActive: true,
      }),
    );
  }

  async deactivateOverride(overrideId: string) {
    const row = await this.overridesRepository.findOne({
      where: { overrideId },
    });
    if (!row) throw new NotFoundException('Override not found');
    row.isActive = false;
    return this.overridesRepository.save(row);
  }

  async quotePrice(offerType: PromotionOfferType, productIds: string[]) {
    const offer = await this.requireActiveOffer(offerType);
    const uniqueIds = [...new Set(productIds.filter(Boolean))];

    if (offerType === PromotionOfferType.PACK && uniqueIds.length < 2) {
      throw new BadRequestException('A pack requires at least 2 products');
    }
    if (offerType !== PromotionOfferType.PACK && uniqueIds.length !== 1) {
      throw new BadRequestException('This offer requires exactly 1 product');
    }

    const primaryProductId = uniqueIds[0];
    const resolved = await this.resolvePricing(offer, primaryProductId);

    return {
      offerType,
      offerName: offer.name,
      productIds: uniqueIds,
      unitPrice: resolved.price,
      totalPrice: resolved.price,
      defaultDurationDays: resolved.durationDays,
      durationOptions: [7, 14, 30],
      overrideReason: resolved.reason,
      usedOverride: Boolean(resolved.reason),
    };
  }

  async createCompanyCampaign(
    userId: string,
    dto: CreatePromotionCampaignDto,
  ) {
    const company = await this.getCompanyForUser(userId);
    const offer = await this.requireActiveOffer(dto.offerType);
    const productIds = [...new Set(dto.productIds.filter(Boolean))];

    if (![7, 14, 30, offer.defaultDurationDays].includes(dto.durationDays)) {
      throw new BadRequestException(
        'Duration must be 7, 14, 30 days, or the offer default',
      );
    }

    if (dto.offerType === PromotionOfferType.PACK && productIds.length < 2) {
      throw new BadRequestException('A pack requires at least 2 products');
    }
    if (dto.offerType !== PromotionOfferType.PACK && productIds.length !== 1) {
      throw new BadRequestException('This offer requires exactly 1 product');
    }

    const products = await this.productsRepository.find({
      where: {
        productId: In(productIds),
        companyId: company.companyId,
        verificationStatus: VerificationStatus.APPROVED,
      },
    });

    if (products.length !== productIds.length) {
      throw new BadRequestException(
        'All products must be yours and approved before promotion',
      );
    }

    const resolved = await this.resolvePricing(offer, productIds[0]);

    const campaign = await this.campaignsRepository.save(
      this.campaignsRepository.create({
        companyId: company.companyId,
        offerType: dto.offerType,
        status: PromotionStatus.PENDING_PAYMENT,
        durationDays: dto.durationDays,
        unitPrice: resolved.price,
        totalPrice: resolved.price,
        priceOverrideReason: resolved.reason,
        paidAt: null,
        startsAt: null,
        endsAt: null,
      }),
    );

    for (const productId of productIds) {
      await this.campaignProductsRepository.save(
        this.campaignProductsRepository.create({
          campaignId: campaign.campaignId,
          productId,
        }),
      );
    }

    return this.getCampaignView(campaign.campaignId);
  }

  async confirmCampaignPayment(userId: string, campaignId: string) {
    const company = await this.getCompanyForUser(userId);
    const campaign = await this.campaignsRepository.findOne({
      where: { campaignId, companyId: company.companyId },
      relations: { products: { product: true }, company: true },
    });

    if (!campaign) throw new NotFoundException('Campaign not found');

    if (campaign.status === PromotionStatus.ACTIVE) {
      return this.toCampaignView(campaign);
    }

    if (campaign.status !== PromotionStatus.PENDING_PAYMENT) {
      throw new BadRequestException('Campaign cannot be paid in this status');
    }

    const now = new Date();
    const endsAt = new Date(now);
    endsAt.setDate(endsAt.getDate() + campaign.durationDays);

    campaign.status = PromotionStatus.ACTIVE;
    campaign.paidAt = now;
    campaign.startsAt = now;
    campaign.endsAt = endsAt;
    await this.campaignsRepository.save(campaign);

    return this.toCampaignView(campaign);
  }

  async cancelCompanyCampaign(userId: string, campaignId: string) {
    const company = await this.getCompanyForUser(userId);
    const campaign = await this.campaignsRepository.findOne({
      where: { campaignId, companyId: company.companyId },
      relations: { products: { product: true }, company: true },
    });
    if (!campaign) throw new NotFoundException('Campaign not found');
    if (campaign.status !== PromotionStatus.PENDING_PAYMENT) {
      throw new BadRequestException('Only unpaid campaigns can be cancelled');
    }
    campaign.status = PromotionStatus.CANCELLED;
    await this.campaignsRepository.save(campaign);
    return this.toCampaignView(campaign);
  }

  async listCompanyCampaigns(userId: string) {
    const company = await this.getCompanyForUser(userId);
    await this.expireDueCampaigns();
    const campaigns = await this.campaignsRepository.find({
      where: { companyId: company.companyId },
      relations: { products: { product: true }, company: true },
      order: { createdAt: 'DESC' },
    });
    return campaigns.map((c) => this.toCampaignView(c));
  }

  async listAllCampaigns() {
    await this.expireDueCampaigns();
    const campaigns = await this.campaignsRepository.find({
      relations: { products: { product: true }, company: true },
      order: { createdAt: 'DESC' },
    });
    return campaigns.map((c) => this.toCampaignView(c));
  }

  async getAdminRevenue() {
    await this.expireDueCampaigns();

    const paidCampaigns = await this.campaignsRepository.find({
      where: [
        { status: PromotionStatus.ACTIVE },
        { status: PromotionStatus.EXPIRED },
      ],
      relations: { products: { product: true }, company: true },
      order: { paidAt: 'DESC' },
    });

    const payments = paidCampaigns.filter((c) => c.paidAt != null);

    const now = new Date();
    const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);

    let total = 0;
    let thisMonth = 0;
    const byOfferType = new Map<PromotionOfferType, number>();

    for (const campaign of payments) {
      const amount = Number(campaign.totalPrice);
      total += amount;
      if (campaign.paidAt && campaign.paidAt >= monthStart) {
        thisMonth += amount;
      }
      byOfferType.set(
        campaign.offerType,
        (byOfferType.get(campaign.offerType) ?? 0) + amount,
      );
    }

    const round = (value: number) => Math.round(value * 100) / 100;

    return {
      total: round(total),
      thisMonth: round(thisMonth),
      paidCampaigns: payments.length,
      byOfferType: Array.from(byOfferType.entries()).map(
        ([offerType, amount]) => ({
          offerType,
          amount: round(amount),
        }),
      ),
      payments: payments.map((c) => this.toCampaignView(c)),
    };
  }

  async getActiveSponsorshipMap() {
    await this.expireDueCampaigns();
    const now = new Date();
    const active = await this.campaignsRepository.find({
      where: {
        status: PromotionStatus.ACTIVE,
        endsAt: MoreThan(now),
      },
      relations: { products: true },
      order: { paidAt: 'DESC' },
    });

    type Boost = {
      home: boolean;
      category: boolean;
      search: boolean;
      paidAt: string | null;
      campaignId: string;
    };

    const map = new Map<string, Boost>();

    for (const campaign of active) {
      const paidAt = campaign.paidAt
        ? new Date(campaign.paidAt).toISOString()
        : null;
      const appliesHome =
        campaign.offerType === PromotionOfferType.HOME_SPOTLIGHT ||
        campaign.offerType === PromotionOfferType.PACK;
      const appliesCategory =
        campaign.offerType === PromotionOfferType.CATEGORY_BOOST ||
        campaign.offerType === PromotionOfferType.PACK;
      const appliesSearch =
        campaign.offerType === PromotionOfferType.SEARCH_BOOST ||
        campaign.offerType === PromotionOfferType.PACK;

      for (const item of campaign.products ?? []) {
        const existing = map.get(item.productId);
        if (!existing) {
          map.set(item.productId, {
            home: appliesHome,
            category: appliesCategory,
            search: appliesSearch,
            paidAt,
            campaignId: campaign.campaignId,
          });
          continue;
        }
        existing.home = existing.home || appliesHome;
        existing.category = existing.category || appliesCategory;
        existing.search = existing.search || appliesSearch;
        if (
          paidAt &&
          (!existing.paidAt || paidAt > existing.paidAt)
        ) {
          existing.paidAt = paidAt;
          existing.campaignId = campaign.campaignId;
        }
      }
    }

    return map;
  }

  private async resolvePricing(
    offer: PromotionOffer,
    productId: string | null,
  ) {
    let price = Number(offer.defaultPrice);
    let durationDays = offer.defaultDurationDays;
    let reason: string | null = null;

    if (productId) {
      const productOverride = await this.overridesRepository.findOne({
        where: {
          offerType: offer.offerType,
          productId,
          isActive: true,
        },
        order: { createdAt: 'DESC' },
      });
      if (productOverride) {
        price = Number(productOverride.price);
        if (productOverride.durationDays) {
          durationDays = productOverride.durationDays;
        }
        reason = productOverride.reason;
        return { price, durationDays, reason };
      }
    }

    const offerOverride = await this.overridesRepository.findOne({
      where: {
        offerType: offer.offerType,
        productId: IsNull(),
        isActive: true,
      },
      order: { createdAt: 'DESC' },
    });

    if (offerOverride) {
      price = Number(offerOverride.price);
      if (offerOverride.durationDays) {
        durationDays = offerOverride.durationDays;
      }
      reason = offerOverride.reason;
    }

    return { price, durationDays, reason };
  }

  private async requireActiveOffer(offerType: PromotionOfferType) {
    const offer = await this.offersRepository.findOne({ where: { offerType } });
    if (!offer || !offer.isActive) {
      throw new BadRequestException('This promotion offer is not available');
    }
    return offer;
  }

  private async getCompanyForUser(userId: string) {
    const company = await this.companiesRepository.findOne({
      where: { userId },
    });
    if (!company) throw new ForbiddenException('Company account not found');
    return company;
  }

  private async getCampaignView(campaignId: string) {
    const campaign = await this.campaignsRepository.findOne({
      where: { campaignId },
      relations: { products: { product: true }, company: true },
    });
    if (!campaign) throw new NotFoundException('Campaign not found');
    return this.toCampaignView(campaign);
  }

  private toCampaignView(campaign: PromotionCampaign) {
    return {
      campaignId: campaign.campaignId,
      companyId: campaign.companyId,
      companyName: campaign.company?.companyName ?? 'Company',
      offerType: campaign.offerType,
      status: campaign.status,
      durationDays: campaign.durationDays,
      unitPrice: Number(campaign.unitPrice),
      totalPrice: Number(campaign.totalPrice),
      priceOverrideReason: campaign.priceOverrideReason,
      paidAt: campaign.paidAt,
      startsAt: campaign.startsAt,
      endsAt: campaign.endsAt,
      createdAt: campaign.createdAt,
      products: (campaign.products ?? []).map((item) => ({
        productId: item.productId,
        name: item.product?.name ?? 'Product',
        price: item.product ? Number(item.product.price) : null,
        images: item.product?.images ?? null,
      })),
    };
  }

  private async expireDueCampaigns() {
    const now = new Date();
    const due = await this.campaignsRepository.find({
      where: {
        status: PromotionStatus.ACTIVE,
        endsAt: LessThanOrEqual(now),
      },
    });
    for (const campaign of due) {
      campaign.status = PromotionStatus.EXPIRED;
      await this.campaignsRepository.save(campaign);
    }
  }
}
