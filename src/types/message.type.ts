export type SendMessage = {
  conversationId: number;
  senderId: number;
  text: string;
  nonce: string;
  replyToId: number | null;
  forwardedFromMsgId: number | null;
};
