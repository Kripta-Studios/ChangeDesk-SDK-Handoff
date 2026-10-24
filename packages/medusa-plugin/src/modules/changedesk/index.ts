import { Module } from "@medusajs/framework/utils"
import validateOptions from "./loaders/validate-options.ts"
import ChangeDeskModuleService from "./service.ts"

export const CHANGEDESK_MODULE = "changedesk"

export default Module(CHANGEDESK_MODULE, {
  service: ChangeDeskModuleService,
  loaders: [validateOptions],
})
