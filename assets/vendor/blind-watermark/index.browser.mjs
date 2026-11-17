// lib/index.ts
import BlindWatermarkModuleFactory from "./glue.mjs";
var wasmModule = null;
var initPromise = null;
var defaultConfig = {
  passwordWm: 1,
  passwordImg: 1,
  d1: 36,
  d2: 0,
  // secondary singular value off by default - see note in README (lowers robustness)
  blockSize: 4,
  dwtLevel: 1,
  redundancy: 3
};
async function init() {
  if (wasmModule) return wasmModule;
  if (!initPromise) {
    initPromise = BlindWatermarkModuleFactory().then((module) => {
      wasmModule = module;
      return module;
    });
  }
  return initPromise;
}
var BlindWatermark = class {
  constructor(config = {}) {
    this.config = { ...defaultConfig, ...config };
  }
  applyConfig(module) {
    module.setConfig(
      this.config.passwordWm,
      this.config.passwordImg,
      this.config.d1,
      this.config.d2,
      this.config.blockSize,
      this.config.dwtLevel,
      this.config.redundancy
    );
  }
  /**
   * Embed a string watermark into an image
   * @param imageData - Image data as Uint8Array (PNG, JPEG, or WebP)
   * @param watermarkText - Text to embed
   * @param format - Output format: 'png', 'jpg', or 'webp'
   * @returns Embedded image data and watermark bit length
   */
  async embedString(imageData, watermarkText, format = "png") {
    const module = await init();
    this.applyConfig(module);
    const result = module.embedStringWatermark(imageData, watermarkText, format);
    if (result.error) {
      throw new Error(result.error);
    }
    return {
      imageData: new Uint8Array(result.imageData),
      wmBitLength: result.wmBitLength
    };
  }
  /**
   * Extract a string watermark from an image
   * @param imageData - Image data as Uint8Array
   * @param wmBitLength - Length of watermark in bits (from embed result)
   * @returns Extracted watermark text
   */
  async extractString(imageData, wmBitLength) {
    const module = await init();
    this.applyConfig(module);
    const result = module.extractStringWatermark(imageData, wmBitLength);
    if (result.error) {
      throw new Error(result.error);
    }
    return result.text;
  }
  /**
   * Embed binary watermark data into an image
   * @param imageData - Image data as Uint8Array
   * @param bits - Binary data as string of '0' and '1'
   * @param format - Output format
   * @returns Embedded image data and watermark bit length
   */
  async embedBinary(imageData, bits, format = "png") {
    if (!/^[01]+$/.test(bits)) {
      throw new Error("bits must be a non-empty string of '0' and '1'");
    }
    const module = await init();
    this.applyConfig(module);
    const result = module.embedBinaryWatermark(imageData, bits, format);
    if (result.error) {
      throw new Error(result.error);
    }
    return {
      imageData: new Uint8Array(result.imageData),
      wmBitLength: result.wmBitLength
    };
  }
  /**
   * Extract binary watermark from an image
   * @param imageData - Image data as Uint8Array
   * @param wmBitLength - Length of watermark in bits
   * @returns Binary data as string of '0' and '1'
   */
  async extractBinary(imageData, wmBitLength) {
    const module = await init();
    this.applyConfig(module);
    const result = module.extractBinaryWatermark(imageData, wmBitLength);
    if (result.error) {
      throw new Error(result.error);
    }
    return result.bits;
  }
  /**
   * Embed a self-describing watermark 鈥?recommended. The payload length is stored
   * in the image, so {@link extract} needs no extra information to read it back.
   * @param imageData - Image data as Uint8Array (PNG, JPEG, or WebP)
   * @param data - Text (UTF-8) or raw bytes to embed
   * @param format - Output format: 'png' (recommended), 'jpg', or 'webp'
   * @returns Watermarked image bytes
   */
  async embed(imageData, data, format = "png") {
    const module = await init();
    this.applyConfig(module);
    const isText = typeof data === "string";
    const payload = isText ? new TextEncoder().encode(data) : data;
    const result = module.embedSelfDescribing(imageData, payload, isText, format);
    if (result.error) {
      throw new Error(result.error);
    }
    return new Uint8Array(result.imageData);
  }
  /**
   * Extract a self-describing watermark without knowing its length.
   * @param imageData - Image data as Uint8Array
   * @returns The extraction result, or `null` if no watermark was found
   *          (wrong password or no watermark). Check `.valid` for integrity.
   * @throws If the input cannot be decoded as an image (an invalid file is a
   *         failure, distinct from `null` which means "decoded fine, no watermark").
   */
  async extract(imageData) {
    const module = await init();
    this.applyConfig(module);
    const r = module.extractSelfDescribing(imageData);
    if (r.error) throw new Error(r.error);
    if (!r.found) return null;
    const bytes = new Uint8Array(r.payload);
    return {
      found: true,
      valid: !!r.valid,
      version: r.version | 0,
      isText: !!r.isText,
      bytes,
      text: r.isText ? new TextDecoder().decode(bytes) : void 0
    };
  }
  /**
   * Check whether an image carries a watermark for this config, without
   * materialising the payload as text.
   * @param imageData - Image data as Uint8Array
   */
  async detect(imageData) {
    const module = await init();
    this.applyConfig(module);
    const r = module.extractSelfDescribing(imageData);
    if (r.error) throw new Error(r.error);
    return {
      found: !!r.found,
      valid: !!r.valid,
      version: r.version | 0,
      isText: !!r.isText,
      byteLength: r.found && r.payload ? r.payload.length : 0
    };
  }
};
async function embedStringWatermark(imageData, watermarkText, config = {}, format = "png") {
  const bwm = new BlindWatermark(config);
  return bwm.embedString(imageData, watermarkText, format);
}
async function extractStringWatermark(imageData, wmBitLength, config = {}) {
  const bwm = new BlindWatermark(config);
  return bwm.extractString(imageData, wmBitLength);
}
async function embedWatermark(imageData, data, config = {}, format = "png") {
  const bwm = new BlindWatermark(config);
  return bwm.embed(imageData, data, format);
}
async function extractWatermark(imageData, config = {}) {
  const bwm = new BlindWatermark(config);
  return bwm.extract(imageData);
}
var index_default = BlindWatermark;
export {
  BlindWatermark,
  index_default as default,
  embedStringWatermark,
  embedWatermark,
  extractStringWatermark,
  extractWatermark
};
