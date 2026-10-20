namespace RpRoll.Server.Rolls;

/// <summary>The dice /roll and the dice tray accept. The value is the number of sides.</summary>
public enum DieType
{
    D6 = 6,
    D10 = 10,
    D20 = 20,

    /// <summary>A ten-sided die numbered 10, 20 ... 100. For a value like 87, players throw it with a d10.</summary>
    D100 = 100,
}
