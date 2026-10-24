import { model } from "@medusajs/framework/utils"

const DelegationNonce = model
  .define("changedesk_delegation_nonce", {
    id: model.id().primaryKey(),
    jti: model.text(),
    expires_at: model.dateTime(),
  })
  .indexes([{ on: ["jti"], unique: true }])

export default DelegationNonce
