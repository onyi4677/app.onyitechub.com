def analyze_idea(text: str) -> dict:
    return {
        "summary": "Prototype analysis completed. The idea contains a research problem that can be developed into a structured study.",
        "word_count": len(text.split()),
        "suggestions": [
            "Define the target population and study setting.",
            "Convert the central idea into one measurable research question.",
            "Identify key variables and the proposed study design.",
        ],
    }
