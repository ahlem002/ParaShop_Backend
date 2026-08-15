import {
  BadRequestException,
  Injectable,
  ServiceUnavailableException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectRepository } from '@nestjs/typeorm';
import { Brackets, Repository } from 'typeorm';
import { Product } from '../products/entities/product.entity';
import { VerificationStatus } from '../common/enums/verification-status.enum';
import { AiChatDto } from './dto/ai-chat.dto';

type CatalogProduct = {
  productId: string;
  name: string;
  description: string | null;
  notice: string | null;
  laboratory: string;
  price: number;
  stock: number;
  category: string | null;
  companyName: string | null;
  image: string | null;
};

type GeminiChatResult = {
  reply: string;
  suggestedProductIds: string[];
};

@Injectable()
export class AiService {
  private readonly rateLimit = new Map<string, { count: number; resetAt: number }>();

  constructor(
    private readonly configService: ConfigService,
    @InjectRepository(Product)
    private readonly productsRepository: Repository<Product>,
  ) {}

  async chat(dto: AiChatDto, clientKey: string) {
    this.assertRateLimit(clientKey);

    const apiKey = this.configService.get<string>('GEMINI_API_KEY')?.trim();
    if (!apiKey) {
      throw new ServiceUnavailableException(
        'AI assistant is not configured. Add GEMINI_API_KEY to the backend .env (free key from Google AI Studio).',
      );
    }

    const message = dto.message.trim();
    if (!message) {
      throw new BadRequestException('Message is required');
    }

    const catalog = await this.findRelevantProducts(message, dto.productId);
    const model =
      this.configService.get<string>('GEMINI_MODEL')?.trim() ||
      'gemini-3.6-flash';

    const result = await this.callGemini({
      apiKey,
      model,
      message,
      history: dto.history ?? [],
      catalog,
      focusProductId: dto.productId,
    });

    const catalogById = new Map(catalog.map((p) => [p.productId, p]));
    const suggestions = result.suggestedProductIds
      .map((id) => catalogById.get(id))
      .filter((p): p is CatalogProduct => Boolean(p))
      .slice(0, 4)
      .map((p) => ({
        productId: p.productId,
        name: p.name,
        price: p.price,
        image: p.image,
        category: p.category,
        laboratory: p.laboratory,
      }));

    return {
      reply: result.reply,
      suggestions,
      disclaimer:
        'This AI assistant does not replace a doctor or pharmacist. For medical advice, consult a qualified professional.',
    };
  }

  private assertRateLimit(clientKey: string) {
    const now = Date.now();
    const windowMs = 60_000;
    const maxRequests = 20;
    const entry = this.rateLimit.get(clientKey);

    if (!entry || entry.resetAt <= now) {
      this.rateLimit.set(clientKey, { count: 1, resetAt: now + windowMs });
      return;
    }

    if (entry.count >= maxRequests) {
      throw new BadRequestException(
        'Too many questions. Please wait a minute and try again.',
      );
    }

    entry.count += 1;
  }

  private async findRelevantProducts(
    query: string,
    focusProductId?: string,
  ): Promise<CatalogProduct[]> {
    const selected = new Map<string, CatalogProduct>();

    if (focusProductId) {
      const focused = await this.productsRepository.findOne({
        where: {
          productId: focusProductId,
          verificationStatus: VerificationStatus.APPROVED,
        },
        relations: { category: true, company: true },
      });
      if (focused) {
        selected.set(focused.productId, this.toCatalogProduct(focused));
      }
    }

    const tokens = query
      .toLowerCase()
      .split(/[^a-z0-9àâäéèêëïîôùûüç]+/i)
      .map((t) => t.trim())
      .filter((t) => t.length >= 3)
      .slice(0, 8);

    const qb = this.productsRepository
      .createQueryBuilder('product')
      .leftJoinAndSelect('product.category', 'category')
      .leftJoinAndSelect('product.company', 'company')
      .where('product.verificationStatus = :status', {
        status: VerificationStatus.APPROVED,
      })
      .orderBy('product.updatedAt', 'DESC')
      .take(12);

    if (tokens.length > 0 || query.length >= 3) {
      qb.andWhere(
        new Brackets((where) => {
          where.where('LOWER(product.name) LIKE :full', {
            full: `%${query.toLowerCase()}%`,
          });
          where.orWhere('LOWER(product.description) LIKE :full', {
            full: `%${query.toLowerCase()}%`,
          });
          where.orWhere('LOWER(product.notice) LIKE :full', {
            full: `%${query.toLowerCase()}%`,
          });
          where.orWhere('LOWER(product.laboratory) LIKE :full', {
            full: `%${query.toLowerCase()}%`,
          });
          where.orWhere('LOWER(category.name) LIKE :full', {
            full: `%${query.toLowerCase()}%`,
          });

          tokens.forEach((token, index) => {
            const key = `token${index}`;
            where.orWhere(`LOWER(product.name) LIKE :${key}`, {
              [key]: `%${token}%`,
            });
            where.orWhere(`LOWER(product.description) LIKE :${key}`, {
              [key]: `%${token}%`,
            });
            where.orWhere(`LOWER(category.name) LIKE :${key}`, {
              [key]: `%${token}%`,
            });
          });
        }),
      );
    }

    const matches = await qb.getMany();
    for (const product of matches) {
      selected.set(product.productId, this.toCatalogProduct(product));
    }

    if (selected.size < 6) {
      const fallback = await this.productsRepository.find({
        where: { verificationStatus: VerificationStatus.APPROVED },
        relations: { category: true, company: true },
        order: { updatedAt: 'DESC' },
        take: 8,
      });
      for (const product of fallback) {
        selected.set(product.productId, this.toCatalogProduct(product));
        if (selected.size >= 10) break;
      }
    }

    return Array.from(selected.values()).slice(0, 10);
  }

  private toCatalogProduct(product: Product): CatalogProduct {
    return {
      productId: product.productId,
      name: product.name,
      description: product.description,
      notice: product.notice,
      laboratory: product.laboratory,
      price: Number(product.price),
      stock: product.stock,
      category: product.category?.name ?? null,
      companyName: product.company?.companyName ?? null,
      image: product.images?.[0] ?? null,
    };
  }

  private async callGemini(params: {
    apiKey: string;
    model: string;
    message: string;
    history: Array<{ role: 'user' | 'assistant'; content: string }>;
    catalog: CatalogProduct[];
    focusProductId?: string;
  }): Promise<GeminiChatResult> {
    const catalogJson = JSON.stringify(
      params.catalog.map((p) => ({
        productId: p.productId,
        name: p.name,
        description: p.description,
        notice: p.notice,
        laboratory: p.laboratory,
        price: p.price,
        stock: p.stock,
        category: p.category,
        companyName: p.companyName,
      })),
    );

    const system = [
      'You are ParaShop+, a helpful parapharmacy shopping assistant.',
      'Always answer in English.',
      'You can explain products, give general wellness tips, answer FAQs, suggest similar catalog products, and guide users around the shop.',
      'You are NOT a doctor or pharmacist and you do not replace medical advice.',
      'Never diagnose, prescribe, or tell someone to start/stop a treatment.',
      'If the question is medical or urgent, advise seeing a doctor or pharmacist.',
      'Only recommend products that appear in CATALOG. Never invent products, prices, or medicines.',
      'When suggesting products, include their productId values from CATALOG in suggestedProductIds.',
      'Keep replies concise, clear, and friendly.',
      params.focusProductId
        ? `The user is currently viewing productId=${params.focusProductId}. Prefer explaining that product when relevant.`
        : '',
      'Return ONLY valid JSON with this shape:',
      '{"reply":"string","suggestedProductIds":["uuid", "..."]}',
      `CATALOG: ${catalogJson}`,
    ]
      .filter(Boolean)
      .join('\n');

    const contents = [
      ...params.history.slice(-10).map((item) => ({
        role: item.role === 'assistant' ? 'model' : 'user',
        parts: [{ text: item.content }],
      })),
      {
        role: 'user',
        parts: [{ text: params.message }],
      },
    ];

    const url = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(params.model)}:generateContent?key=${encodeURIComponent(params.apiKey)}`;

    let response: Response;
    try {
      response = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          systemInstruction: { parts: [{ text: system }] },
          contents,
          generationConfig: {
            temperature: 0.4,
            maxOutputTokens: 800,
            responseMimeType: 'application/json',
          },
        }),
      });
    } catch {
      throw new ServiceUnavailableException(
        'Could not reach the AI service. Try again in a moment.',
      );
    }

    if (!response.ok) {
      let detail = `Gemini error (${response.status})`;
      try {
        const body = (await response.json()) as {
          error?: { message?: string };
        };
        if (body.error?.message) detail = body.error.message;
      } catch {
        // ignore
      }
      throw new ServiceUnavailableException(detail);
    }

    const payload = (await response.json()) as {
      candidates?: Array<{
        content?: { parts?: Array<{ text?: string }> };
      }>;
    };

    const rawText =
      payload.candidates?.[0]?.content?.parts
        ?.map((part) => part.text ?? '')
        .join('')
        .trim() ?? '';

    const parsed = this.parseGeminiJson(rawText);
    if (!parsed.reply) {
      throw new ServiceUnavailableException(
        'The AI returned an empty answer. Please try again.',
      );
    }

    return parsed;
  }

  private parseGeminiJson(rawText: string): GeminiChatResult {
    try {
      const cleaned = rawText
        .replace(/^```json\s*/i, '')
        .replace(/^```\s*/i, '')
        .replace(/\s*```$/, '')
        .trim();
      const data = JSON.parse(cleaned) as {
        reply?: string;
        suggestedProductIds?: unknown;
      };
      const ids = Array.isArray(data.suggestedProductIds)
        ? data.suggestedProductIds.filter(
            (id): id is string => typeof id === 'string',
          )
        : [];
      return {
        reply: typeof data.reply === 'string' ? data.reply.trim() : '',
        suggestedProductIds: ids,
      };
    } catch {
      return {
        reply: rawText || 'Sorry, I could not process that question.',
        suggestedProductIds: [],
      };
    }
  }
}
