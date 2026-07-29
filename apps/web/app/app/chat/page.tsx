import { getServerConversations } from "@/lib/server/backend";
import { swrKeys } from "@/lib/swr-keys";
import { SWRFallback } from "@/providers/SWRFallback";
import { ChatView } from "@/components/chat/ChatView";

export default async function ChatPage() {
  const conversations = await getServerConversations();
  return (
    <SWRFallback fallback={{ [swrKeys.conversations]: conversations }}>
      <ChatView />
    </SWRFallback>
  );
}
