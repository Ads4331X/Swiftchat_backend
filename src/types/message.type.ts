export type SendMessage = {
  conversationId: number;
  senderId: number;
  text: string;
  nonce: string | null;
  replyToId: number | null;
  forwardedFromMsgId: number | null;
  file?: Express.Multer.File;
  encryptedKey?: string;
  encryptedHeader?: string;
  keyNonce?: string;
  headerNonce?: string;
};
