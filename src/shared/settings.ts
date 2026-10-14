import { z } from 'zod'

export const proxySettingsSchema = z.object({
  mode: z.enum(['system', 'custom']),
  protocol: z.enum(['http', 'https', 'socks5']),
  host: z.string().max(253).regex(/^(?:[a-zA-Z0-9.-]+|\[[a-fA-F0-9:]+\])?$/, '主机不能包含协议、路径或凭证'),
  port: z.number().int().min(1).max(65535),
  username: z.string().max(128).optional(),
  hasCredential: z.boolean().optional()
}).strict()
export const settingsSchema = z.object({
  theme: z.enum(['dark', 'light', 'system']),
  expertMode: z.boolean(),
  platformToolsPath: z.string().max(8192).optional(),
  contentRepository: z.string().max(200).refine((value) => !value || /^[\w.-]+\/[\w.-]+$/.test(value), '仓库格式应为 owner/repo').optional(),
  contentPublicKey: z.string().max(8192).optional(),
  proxy: proxySettingsSchema
}).strict().refine((value) => value.proxy.mode === 'system' || Boolean(value.proxy.host), '自定义代理必须填写主机')
export const settingsPatchSchema = z.object({
  theme: z.enum(['dark', 'light', 'system']).optional(),
  expertMode: z.boolean().optional(),
  platformToolsPath: z.string().max(8192).optional(),
  contentRepository: z.string().max(200).refine((value) => !value || /^[\w.-]+\/[\w.-]+$/.test(value), '仓库格式应为 owner/repo').optional(),
  contentPublicKey: z.string().max(8192).optional(),
  proxy: proxySettingsSchema.optional(),
  proxyPassword: z.string().max(1024).optional()
}).strict()
