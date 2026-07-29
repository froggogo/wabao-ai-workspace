import { getServerConversation, getServerConversations } from "@/lib/server/backend";
import { swrKeys } from "@/lib/swr-keys";
import { SWRFallback } from "@/providers/SWRFallback";
import { ChatView } from "@/components/chat/ChatView";

export default async function ChatConversationPage({
  params,
}: {
  params: Promise<{ conversationId: string }>;
}) {
  const { conversationId } = await params;
  const [conversations, conversation] = await Promise.all([
    getServerConversations(),
    getServerConversation(conversationId),
  ]);

  const fallback: Record<string, unknown> = {
    [swrKeys.conversations]: conversations,
  };
  if (conversation) {
    fallback[swrKeys.conversation(conversationId)] = conversation;
  }

  return (
    <SWRFallback fallback={fallback}>
      <ChatView conversationId={conversationId} />
    </SWRFallback>
  );
}
