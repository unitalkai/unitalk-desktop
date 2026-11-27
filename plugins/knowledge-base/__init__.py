from __future__ import annotations

from . import tools


def register(ctx) -> None:
    ctx.register_tool(
        name="knowledge_search",
        toolset=tools.TOOLSET,
        schema=tools.KNOWLEDGE_SEARCH_SCHEMA,
        handler=tools.handle_knowledge_search,
        check_fn=tools.check_available,
        description=tools.KNOWLEDGE_SEARCH_SCHEMA["description"],
        emoji="📚",
    )
    ctx.register_tool(
        name="knowledge_list_bases",
        toolset=tools.TOOLSET,
        schema=tools.KNOWLEDGE_LIST_BASES_SCHEMA,
        handler=tools.handle_knowledge_list_bases,
        check_fn=tools.check_available,
        description=tools.KNOWLEDGE_LIST_BASES_SCHEMA["description"],
        emoji="📚",
    )
    ctx.register_system_prompt_section("knowledge-base", tools.system_prompt_section)
