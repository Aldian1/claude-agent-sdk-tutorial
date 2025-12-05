import { pipeline } from '@xenova/transformers';
import { logger } from './logger.js';

/**
 * Cached embedding pipeline instance
 */
let embeddingPipeline: any = null;

/**
 * Initialize the embedding pipeline (lazy loading)
 */
async function getEmbeddingPipeline() {
  if (!embeddingPipeline) {
    logger.debug('Loading embedding model: Supabase/gte-small');
    embeddingPipeline = await pipeline(
      'feature-extraction',
      'Supabase/gte-small'
    );
    logger.debug('Embedding model loaded successfully');
  }
  return embeddingPipeline;
}

/**
 * Generate an embedding vector for the given text using gte-small model
 * Returns a 384-dimensional vector
 */
export async function generateEmbedding(text: string): Promise<number[]> {
  try {
    const model = await getEmbeddingPipeline();
    
    logger.debug(`Generating embedding for text (${text.length} chars)`);
    
    const output = await model(text, {
      pooling: 'mean',
      normalize: true,
    });

    // Extract the embedding array
    const embedding = Array.from(output.data) as number[];
    
    logger.debug(`Generated embedding with ${embedding.length} dimensions`);
    
    if (embedding.length !== 384) {
      throw new Error(
        `Expected 384 dimensions but got ${embedding.length}. ` +
        `This may indicate an issue with the embedding model.`
      );
    }

    return embedding;
  } catch (error) {
    logger.error('Error generating embedding:', error);
    throw error;
  }
}

