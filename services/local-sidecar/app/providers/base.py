from __future__ import annotations

from abc import ABC, abstractmethod
from collections.abc import AsyncIterator


class ProviderAdapter(ABC):
    @abstractmethod
    async def stream_completion(
        self,
        *,
        system_prompt: str,
        user_prompt: str,
        model: str | None = None,
    ) -> AsyncIterator[str]:
        raise NotImplementedError
