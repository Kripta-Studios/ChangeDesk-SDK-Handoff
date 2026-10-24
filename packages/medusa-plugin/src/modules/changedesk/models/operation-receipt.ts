import { model } from "@medusajs/framework/utils"

const OperationReceipt = model
  .define("changedesk_operation_receipt", {
    id: model.id().primaryKey(),
    tenant_id: model.text(),
    operation_key: model.text(),
    actor_id: model.text(),
    execution_id: model.text(),
    row_id: model.text(),
    step_id: model.text(),
    product_id: model.text(),
    destination_id: model.text(),
    capability: model.text(),
    args_hash: model.text(),
    semantic_input_hash: model.text(),
    fence: model.number(),
    status: model.enum(["intent_recorded", "sent", "confirmed", "no_effect", "rejected", "unknown"]),
    readback: model.json().nullable(),
  })
  .indexes([{ on: ["tenant_id", "operation_key"], unique: true }])

export default OperationReceipt
