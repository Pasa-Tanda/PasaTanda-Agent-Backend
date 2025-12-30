import { Controller, Post, Get, Body, Param, Query } from '@nestjs/common';
import { MetaCatalogService } from './services/meta-catalog.service';
import { SalesAgentService } from './agents/sales-agent.service';
import type { SalesToolType } from './whatsapp.types';

/**
 * Controlador de pruebas para operaciones del catálogo de Meta
 * Solo para desarrollo/testing - eliminar o proteger en producción
 */
@Controller('catalog-test')
export class CatalogTestController {
  constructor(
    private readonly metaCatalog: MetaCatalogService,
    private readonly salesAgent: SalesAgentService,
  ) {}

  /**
   * Sincronizar inventario de Supabase a Meta
   * POST /catalog-test/sync-to-meta
   */
  @Post('sync-to-meta')
  async syncToMeta(@Body('companyId') companyId: string) {
    if (!companyId) {
      return { error: 'Se requiere companyId' };
    }
    return await this.metaCatalog.syncInventoryToMeta(companyId);
  }

  /**
   * Sincronizar inventario de Meta a Supabase
   * POST /catalog-test/sync-from-meta
   */
  @Post('sync-from-meta')
  async syncFromMeta(@Body('companyId') companyId: string) {
    if (!companyId) {
      return { error: 'Se requiere companyId' };
    }
    return await this.metaCatalog.syncInventoryFromMeta(companyId);
  }

  /**
   * Listar productos del catálogo de Meta
   * GET /catalog-test/products/:companyId
   */
  @Get('products/:companyId')
  async listProducts(@Param('companyId') companyId: string) {
    const catalogId = await this.metaCatalog.getCatalogId(companyId);
    if (!catalogId) {
      return { error: 'Catalog ID no encontrado' };
    }
    return await this.metaCatalog.listCatalogProducts(catalogId);
  }

  /**
   * Buscar productos
   * GET /catalog-test/search/:companyId?q=term
   */
  @Get('search/:companyId')
  async searchProducts(
    @Param('companyId') companyId: string,
    @Query('q') searchTerm: string,
  ) {
    if (!searchTerm) {
      return { error: 'Se requiere parámetro q (search term)' };
    }
    const catalogId = await this.metaCatalog.getCatalogId(companyId);
    if (!catalogId) {
      return { error: 'Catalog ID no encontrado' };
    }
    return await this.metaCatalog.searchProducts(catalogId, searchTerm);
  }

  /**
   * Obtener información de un producto
   * GET /catalog-test/product/:companyId/:productId
   */
  @Get('product/:companyId/:productId')
  async getProduct(
    @Param('companyId') companyId: string,
    @Param('productId') productId: string,
  ) {
    const catalogId = await this.metaCatalog.getCatalogId(companyId);
    if (!catalogId) {
      return { error: 'Catalog ID no encontrado' };
    }
    return await this.metaCatalog.getProductInfo(catalogId, productId);
  }

  /**
   * Actualizar disponibilidad de producto
   * POST /catalog-test/availability
   */
  @Post('availability')
  async updateAvailability(
    @Body('companyId') companyId: string,
    @Body('productId') productId: string,
    @Body('available') available: boolean,
  ): Promise<any> {
    if (!companyId || !productId || available === undefined) {
      return {
        error: 'Se requieren companyId, productId y available',
      };
    }

    return this.salesAgent.executeCatalogTool(
      'update_product_availability' as SalesToolType,
      companyId,
      { productId, available },
    );
  }

  /**
   * Ejecutar herramienta específica
   * POST /catalog-test/tool
   */
  @Post('tool')
  async executeTool(
    @Body('tool') tool: SalesToolType,
    @Body('companyId') companyId: string,
    @Body('params') params?: Record<string, any>,
  ): Promise<any> {
    if (!tool || !companyId) {
      return {
        error: 'Se requieren tool y companyId',
      };
    }

    return this.salesAgent.executeCatalogTool(tool, companyId, params);
  }

  /**
   * Obtener catalog ID de una compañía
   * GET /catalog-test/catalog-id/:companyId
   */
  @Get('catalog-id/:companyId')
  async getCatalogId(@Param('companyId') companyId: string) {
    const catalogId = await this.metaCatalog.getCatalogId(companyId);
    return {
      companyId,
      catalogId: catalogId || null,
    };
  }
}
