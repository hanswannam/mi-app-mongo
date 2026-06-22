export async function onRequestGet(context) {
  const { env } = context;

  // Obtener variables de entorno
  const mongoApiUrl = env.MONGO_API_URL;
  const mongoApiKey = env.MONGO_API_KEY;
  const mongoDataSource = env.MONGO_DATASOURCE;
  const mongoDatabase = env.MONGO_DATABASE;

  if (!mongoApiUrl || !mongoApiKey || !mongoDataSource || !mongoDatabase) {
    return new Response(
      JSON.stringify({ error: "Faltan variables de entorno para la conexión con MongoDB Atlas Data API." }),
      {
        status: 500,
        headers: { "Content-Type": "application/json" }
      }
    );
  }

  // El endpoint de Atlas Data API para buscar documentos es /action/find
  const url = `${mongoApiUrl.replace(/\/$/, "")}/action/find`;

  const payload = {
    dataSource: mongoDataSource,
    database: mongoDatabase,
    collection: "usuarios",
    filter: {}
  };

  try {
    const response = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "api-key": mongoApiKey
      },
      body: JSON.stringify(payload)
    });

    if (!response.ok) {
      const errorText = await response.text();
      return new Response(
        JSON.stringify({ error: `Error desde MongoDB Data API: ${response.status}`, details: errorText }),
        {
          status: response.status,
          headers: { "Content-Type": "application/json" }
        }
      );
    }

    const data = await response.json();
    return new Response(JSON.stringify(data), {
      status: 200,
      headers: { "Content-Type": "application/json" }
    });
  } catch (error) {
    return new Response(
      JSON.stringify({ error: "Error de red o conexión al intentar acceder a la base de datos.", message: error.message }),
      {
        status: 500,
        headers: { "Content-Type": "application/json" }
      }
    );
  }
}
